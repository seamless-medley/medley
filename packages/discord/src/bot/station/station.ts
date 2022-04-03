import { BoomBox,
  BoomBoxCrate,
  BoomBoxEvents,
  BoomBoxTrack,
  BoomBoxTrackPlay,
  Chanceable,
  Crate,
  decibelsToGain,
  Library,
  Medley,
  MetadataHelper,
  MusicLibrary,
  MusicLibraryDescriptor,
  Queue,
  RequestTrack,
  SweeperInsertionRule,
  TrackCollection,
  TrackKind,
  TrackPeek,
  WatchTrackCollection
} from "@seamless-medley/core";

import { Guild, User } from "discord.js";
import EventEmitter from "events";
import type TypedEventEmitter from 'typed-emitter';
import _, { difference, isFunction, random, sample, shuffle, sortBy } from "lodash";
import normalizePath from 'normalize-path';
import { createExciter } from "./exciter";
import { MetadataCache, createLogger, Logger, CrateLimit } from "@seamless-medley/core";

export enum PlayState {
  Idle = 'idle',
  Playing = 'playing',
  Paused = 'paused'
}

export type SequenceChance = 'random' | [yes: number, no: number] | (() => Promise<boolean>);

export type LimitByUpto = {
  by: 'upto';
  upto: number;
}

export type LimitByRange = {
  by: 'range';
  range: [number, number];
}

export type LimitBySample = {
  by: 'sample' | 'one-of';
  list: number[];
}

export type SequenceLimit = number | 'all' | LimitByUpto | LimitByRange | LimitBySample;

export type SequenceConfig = {
  crateId: string;
  collections: { id: string; weight?: number }[];
  chance?: SequenceChance;
  limit: SequenceLimit;
}

export type StationOptions = {
  id: string;

  name: string;

  description?: string;
  /**
   * Initial audio gain, default to -15dBFS (Appx 0.178)
   * @default -15dBFS
   */
  initialGain?: number;

  musicCollections: MusicLibraryDescriptor[];

  sequences: SequenceConfig[];

  intros?: TrackCollection<BoomBoxTrack>;

  sweeperRules?: SweeperRule[];

  requestSweepers?: TrackCollection<BoomBoxTrack>;

  // BoomBox
  metadataCache?: MetadataCache;
  maxTrackHistory?: number;
  noDuplicatedArtist?: number;
  duplicationSimilarity?: number;
}

export type SweeperConfig = {
  from?: string[];
  to?: string[];
  path: string;
}

export type SweeperRule = SweeperConfig;
export interface StationEvents extends Pick<BoomBoxEvents, 'trackQueued' | 'trackLoaded' | 'trackStarted' | 'trackActive' | 'trackFinished'> {
  ready: () => void;
  requestTrackAdded: (track: TrackPeek<RequestTrack<User['id']>>) => void;
}

export class Station extends (EventEmitter as new () => TypedEventEmitter<StationEvents>) {
  readonly id: string;
  readonly name: string;
  readonly description?: string;

  readonly queue: Queue<BoomBoxTrack>;
  readonly medley: Medley<BoomBoxTrack>;

  private boombox: BoomBox<User['id']>;

  readonly library: MusicLibrary<Station>;
  private sequences: SequenceConfig[] = [];

  readonly initialGain: number;
  private intros?: TrackCollection<BoomBoxTrack>;
  private requestSweepers?: TrackCollection<BoomBoxTrack>;

  private audiences: Map<Guild['id'], Set<User['id']>> = new Map();

  private logger: Logger;

  constructor(options: StationOptions) {
    super();

    this.id = options.id;
    this.name = options.name;
    this.description = options.description;

    this.logger = createLogger({ name: `station/${this.id}`});

    this.queue = new Queue();
    this.medley = new Medley(this.queue);

    if (this.medley.getAudioDevice().type !== 'Null') {
      this.medley.setAudioDevice({ type: 'Null', device: 'Null Device'});
    }

    this.library = new MusicLibrary(this.id, this, options.metadataCache, (options.musicCollections || []));
    this.library.once('ready', () => {
      this.logger.info('Ready');
      this.emit('ready');
    });

    // Create boombox
    const boombox = new BoomBox({
      id: this.id,
      medley: this.medley,
      queue: this.queue,
      crates: [],
      metadataCache: options.metadataCache,
      maxTrackHistory: options.maxTrackHistory,
      noDuplicatedArtist: options.noDuplicatedArtist,
      duplicationSimilarity: options.duplicationSimilarity
    });

    boombox.on('trackQueued', this.handleTrackQueued);
    boombox.on('trackLoaded', this.handleTrackLoaded);
    boombox.on('trackStarted', this.handleTrackStarted);
    boombox.on('trackActive', this.handleTrackActive);
    boombox.on('trackFinished', this.handleTrackFinished);
    boombox.on('requestTrackFetched', this.handleRequestTrack);

    this.boombox = boombox;
    this.initialGain = options.initialGain || decibelsToGain(-15);
    this.intros = options.intros;
    this.requestSweepers = options.requestSweepers;

    this.updateSequence(options.sequences);
    this.updateSweeperRules(options.sweeperRules || []);
  }

  private handleTrackQueued = (track: BoomBoxTrack) => {
    this.emit('trackQueued', track);
  }

  private handleTrackLoaded = (trackPlay: BoomBoxTrackPlay) => {
    this.emit('trackLoaded', trackPlay);
  }

  private handleTrackStarted = (trackPlay: BoomBoxTrackPlay, lastTrack?: BoomBoxTrackPlay) => {
    this.emit('trackStarted', trackPlay, lastTrack);
  }

  private handleTrackActive = (trackPlay: BoomBoxTrackPlay) => {
    this.emit('trackActive', trackPlay);
  }

  private handleTrackFinished = (trackPlay: BoomBoxTrackPlay) => {
    this.emit('trackFinished', trackPlay);
  }

  private handleRequestTrack = (track: RequestTrack<void>) => {
    const { requestSweepers } = this;

    if (requestSweepers) {

      const currentKind = this.boombox.trackPlay?.track.metadata?.kind;

      if (currentKind !== TrackKind.Request) {
        const sweeper = requestSweepers.shift();


        if (sweeper && MetadataHelper.isTrackLoadable(sweeper.path)) {
          this.queue.add(sweeper.path);
          requestSweepers.push(sweeper);
        }
      }
    }
  }

  get playing() {
    return this.medley.playing;
  }

  get paused() {
    return this.medley.paused;
  }

  get playState(): PlayState {
    if (this.paused) return PlayState.Paused;
    if (this.playing) return PlayState.Playing;
    return PlayState.Idle;
  }

  get trackPlay() {
    return this.boombox.trackPlay;
  }

  get trackHistory() {
    return this.boombox.trackHistory;
  }

  skip() {
    this.medley.fadeOut();
  }

  start() {
    if (this.playState === PlayState.Idle && this.queue.length === 0) {
      if (this.intros) {
        const intro = this.intros.shift();
        if (intro) {
          this.queue.add(intro);
          this.intros.push(intro);
        }
      }
    }

    if (!this.medley.playing) {
      this.logger.info('Start playing');
    }

    this.medley.play();
  }

  pause() {
    if (!this.medley.paused) {
      this.medley.togglePause();
    }
  }

  async createExciter() {
    const audioRequest = await this.medley.requestAudioStream({
      bufferSize: 48000 * 5.0,
      buffering: 960, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
      preFill: 48000 * 0.5, // Pre-fill the stream with at least 500ms of audio, to reduce stuttering while encoding to Opus
      // discord voice only accept 48KHz sample rate, 16 bit per sample
      sampleRate: 48000,
      format: 'Int16LE',
      gain: this.initialGain
    });

    return createExciter(audioRequest);
  }

  updateCollections(newCollections: MusicLibraryDescriptor[]) {
    this.library.update(newCollections);
    this.createCrates();
  }

  updateSequence(sequences: SequenceConfig[]) {
    this.sequences = [...sequences];
    this.createCrates();
  }

  async updateLibrary(collections: MusicLibraryDescriptor[]) {
    await this.library.loadCollections(collections);
    this.createCrates();
  }

  private createCrates() {
    this.boombox.crates = this.sequences.map(
      ({ crateId, collections, chance, limit }, index) => {
        const validCollections = collections.filter(col => this.library.has(col.id));

        if (validCollections.length === 0) {
          return;
        }

        const existing = this.boombox.crates.find(c => c.id === crateId);

        return new Crate({
          id: crateId,
          sources: validCollections.map(({ id, weight = 1 }) => ({ collection: this.library.get(id)!, weight })),
          chance: createChanceable(chance),
          limit: this.sequenceLimit(limit),
          max: existing?.max
        });
      })
      .filter((c): c is BoomBoxCrate => c !== undefined);
  }

  private sequenceLimit(limit: SequenceLimit): CrateLimit  {
    if (typeof limit === 'number') {
      return limit;
    }

    if (limit === 'all') {
      return limit;
    }

    const { by } = limit;

    if (by === 'upto') {
      return () => random(1, limit.upto);
    }

    if (by === 'range') {
      const [min, max] = sortBy(limit.range);
      return () => random(min, max);
    }

    if (by === 'sample' || by === 'one-of') {
      return () => sample(limit.list) ?? 0;
    }

    return 0;
  }


  private sweepers: Map<string, WatchTrackCollection<BoomBoxTrack>> = new Map();

  updateSweeperRules(configs: SweeperConfig[]) {
    const oldPaths = this.boombox.sweeperInsertionRules.map(r => r.collection.id);

    this.boombox.sweeperInsertionRules = configs.map<SweeperInsertionRule>(({ from, to, path }) => {
      if (!this.sweepers.has(path)) {
        this.sweepers.set(path, WatchTrackCollection.initWithWatch<BoomBoxTrack>(path, `${normalizePath(path)}/**/*`));
      }

      return {
        from,
        to,
        collection: this.sweepers.get(path)!
      }
    });

    const newPaths = this.boombox.sweeperInsertionRules.map(r => r.collection.id);
    const removedPaths = difference(oldPaths, newPaths);

    for (const path of removedPaths) {
      this.sweepers.get(path)?.unwatchAll();
      this.sweepers.delete(path);
    }
  }

  findTrackById(id: BoomBoxTrack['id']) {
    return this.library.findTrackById(id);
  }

  search(q: Record<'artist' | 'title' | 'query', string | null>, limit?: number) {
    // TODO: Search history
    return this.library.search(q, limit);
  }

  autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string) {
    return this.library.autoSuggest(q, field, narrowBy, narrowTerm);
  }

  async request(trackId: BoomBoxTrack['id'], requestedBy: User['id']) {
    const track = this.findTrackById(trackId);
    if (!track) {
      return false;
    }

    if (!MetadataHelper.isTrackLoadable(track.path)) {
      return false;
    }

    const requestedTrack = this.boombox.request(track, requestedBy);

    this.emit('requestTrackAdded', requestedTrack);

    return requestedTrack;
  }

  get requestsCount() {
    return this.boombox.requestsCount;
  }

  peekRequests(from: number, n: number) {
    return this.boombox.peekRequests(from, n);
  }

  get requestsEnabled() {
    return this.boombox.requestsEnabled;
  }

  set requestsEnabled(value: boolean) {
    this.boombox.requestsEnabled = value;
  }

  sortRequests() {
    this.boombox.sortRequests();
  }

  getRequestsOf(requester: string) {
    return this.boombox.getRequestsOf(requester);
  }

  unrequest(requestIds: number[]) {
    this.boombox.unrequest(requestIds);
  }

  get crateIndex() {
    return this.boombox.crateIndex;
  }

  set crateIndex(newIndex: number) {
    this.boombox.crateIndex = newIndex;
  }

  addAudiences(guildId: Guild['id'], userId: User['id']) {
    if (!this.audiences.has(guildId)) {
      this.audiences.set(guildId, new Set());
    }

    this.audiences.get(guildId)!.add(userId);
    this.playIfHasAudiences();
  }

  removeAudiences(guildId: Guild['id'], userId: User['id']) {
    this.getAudiences(guildId)?.delete(userId);
    this.pauseIfNoAudiences();
  }

  removeAudiencesForGuild(guildId: Guild['id']) {
    this.audiences.delete(guildId);
    this.pauseIfNoAudiences();
  }

  updateAudiences(guildId: Guild['id'], userIds: User['id'][]) {
    this.audiences.set(guildId, new Set(userIds));
    this.playIfHasAudiences();
  }

  private playIfHasAudiences() {
    if (this.playState !== PlayState.Playing && this.hasAudiences) {
      this.logger.info('Start');
      this.start();
    }
  }

  private pauseIfNoAudiences() {
    if (this.playState === PlayState.Playing && !this.hasAudiences) {
      this.logger.info('Pause');
      this.pause();
    }
  }

  getAudiences(guildId: Guild['id']) {
    return this.audiences.get(guildId);
  }

  get totalAudiences() {
    const audiences = new Set<User['id']>();

    for (const ids of this.audiences.values()) {
      for (const id of ids) {
        audiences.add(id);
      }
    }

    return audiences.size;
  }

  get hasAudiences() {
    for (const ids of this.audiences.values()) {
      if (ids.size > 0) {
        return true;
      }
    }

    return false;
  }

  get guildIds() {
    return Array.from(this.audiences.keys());
  }
}

function createChanceable(def: SequenceChance | undefined): Chanceable {
  if (def === 'random') {
    return { next: () => random() === 1 };
  }

  if (isFunction(def)) {
    return { next: def };
  }

  if (Array.isArray(def) && def.length > 1) {
    return chanceOf(def);
  }

  return {
    next: () => true,
    chances: () => [true]
  }
}

function chanceOf(n: [yes: number, no: number]): Chanceable {
  const [yes, no] = n;

  let all = shuffle(
    Array(yes).fill(true)
      .concat(Array(no).fill(false))
  );

  let index = 0;


  return {
    next: () => {
      const v = all[index++];

      if (index >= all.length) {
        index = 0;
        all = shuffle(all);
      }

      return v ?? false;
    },
    chances: () => all
  }
}

export class StationRegistry<S extends Station> extends Library<S, S['id']> {

}