import EventEmitter from "events";
import normalizePath from 'normalize-path';
import { DeckIndex, Medley, Queue, RequestAudioOptions } from "@seamless-medley/medley";
import _, { curry, difference, isFunction, random, sample, shuffle, sortBy } from "lodash";
import type TypedEventEmitter from 'typed-emitter';
import { TrackCollection, TrackPeek, WatchTrackCollection } from "./collections";
import { Chanceable, Crate, CrateLimit } from "./crate";
import { Library, MusicDb, MusicLibrary } from "./library";
import { createLogger, Logger } from "./logging";
import {
  BoomBox,
  BoomBoxCrate,
  BoomBoxEvents,
  BoomBoxTrack,
  BoomBoxTrackPlay,
  RequestTrack,
  SweeperInsertionRule,
  TrackKind
} from "./playout";
import { MetadataHelper } from "./metadata";

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

  useNullAudioDevice?: boolean;

  intros?: TrackCollection<BoomBoxTrack>;

  requestSweepers?: TrackCollection<BoomBoxTrack>;

  // BoomBox
  musicDb: MusicDb;

  maxTrackHistory?: number;
  noDuplicatedArtist?: number;
  duplicationSimilarity?: number;

  followCrateAfterRequestTrack?: boolean;
}

export type SweeperConfig = {
  from?: string[];
  to?: string[];

  /** @deprecated Use TrackCollection instead */
  path: string;
}

// TODO: Union with SweeperInsertionRule
export type SweeperRule = SweeperConfig;

export enum AudienceType {
  Discord = 'discord',
  Icy = 'icy'
}

export type AudienceGroupId = `${AudienceType}$${string}`;


export type Audience = {
  group: AudienceGroupId;
  id: string;
}

export interface StationEvents extends Pick<BoomBoxEvents, 'trackQueued' | 'trackLoaded' | 'trackStarted' | 'trackActive' | 'trackFinished'> {
  ready: () => void;
  requestTrackAdded: (track: TrackPeek<RequestTrack<Audience>>) => void;
}

export class Station extends (EventEmitter as new () => TypedEventEmitter<StationEvents>) {
  readonly id: string;
  readonly name: string;
  readonly description?: string;

  readonly queue: Queue<BoomBoxTrack>;
  readonly medley: Medley<BoomBoxTrack>;

  private boombox: BoomBox<Audience>;

  readonly library: MusicLibrary<Station>;

  intros?: TrackCollection<BoomBoxTrack>;
  requestSweepers?: TrackCollection<BoomBoxTrack>;

  followCrateAfterRequestTrack: boolean;

  private audiences: Map<AudienceGroupId, Map<string, any>> = new Map();

  private logger: Logger;

  constructor(options: Omit<StationOptions, 'musicCollections' | 'sequences' | 'sweeperRules'>) {
    super();

    this.id = options.id;
    this.name = options.name;
    this.description = options.description;

    this.logger = createLogger({ name: `station/${this.id}`});

    this.queue = new Queue();
    this.medley = new Medley(this.queue);

    if (options.useNullAudioDevice ?? true) {
      if (this.getCurrentAudioDevice().type !== 'Null') {
        this.setAudioDevice({ type: 'Null', device: 'Null Device'});
      }
    }

    this.library = new MusicLibrary(
      this.id,
      this,
      options.musicDb
    );

    // Create boombox
    const boombox = new BoomBox<Audience>({
      id: this.id,
      medley: this.medley,
      queue: this.queue,
      crates: [],
      maxTrackHistory: options.maxTrackHistory,
      noDuplicatedArtist: options.noDuplicatedArtist,
      duplicationSimilarity: options.duplicationSimilarity,
      onInsertRequestTrack: this.handleRequestTrack
    });

    boombox.on('trackQueued', this.handleTrackQueued);
    boombox.on('trackLoaded', this.handleTrackLoaded);
    boombox.on('trackStarted', this.handleTrackStarted);
    boombox.on('trackActive', this.handleTrackActive);
    boombox.on('trackFinished', this.handleTrackFinished);

    this.boombox = boombox;
    this.intros = options.intros;
    this.requestSweepers = options.requestSweepers;
    this.followCrateAfterRequestTrack = options.followCrateAfterRequestTrack ?? false;
  }

  get availableAudioDevices() {
    return this.medley.getAvailableDevices();
  }

  getCurrentAudioDevice() {
    return this.medley.getAudioDevice();
  }

  setAudioDevice(descriptor: { type?: string, device?: string }) {
    return this.medley.setAudioDevice(descriptor);
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

  private handleRequestTrack = async (track: RequestTrack<Audience>) => {
    const { requestSweepers } = this;

    if (requestSweepers) {

      const currentKind = this.boombox.trackPlay?.track.extra?.kind;

      if (currentKind !== TrackKind.Request) {
        const sweeper = requestSweepers.shift();

        if (sweeper && await MetadataHelper.isTrackLoadable(sweeper.path)) {
          if (sweeper.extra?.kind === undefined) {
            sweeper.extra = {
              ...sweeper.extra,
              kind: TrackKind.Insertion
            }
          }

          this.queue.add(sweeper);
          requestSweepers.push(sweeper);
        }
      }
    }

    // TODO: Fix this
    if (this.followCrateAfterRequestTrack) {
      const indices = this.boombox.crates.map((crate, index) => ({ ids: new Set(crate.sources.map(s => s.id)), index }));

      const a = indices.slice(0, this.boombox.crateIndex);
      const b = indices.slice(this.boombox.crateIndex);

      const located = [...b, ...a].find(({ ids }) => ids.has(track.collection.id));
      if (located) {
        this.boombox.crateIndex = located.index;
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

  getDeckInfo(index: DeckIndex) {
    return this.boombox.getDeckInfo(index);
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

  private _started = false;

  start() {
    if (this.playState === PlayState.Idle && this.queue.length === 0) {
      if (this.intros) {
        const intro = this.intros.shift();
        if (intro) {
          if (intro.extra?.kind === undefined) {
            intro.extra = {
              ...intro.extra,
              kind: TrackKind.Insertion
            }
          }

          this.queue.add(intro);
          this.intros.push(intro);
        }
      }
    }

    if (!this._started) {
      this._started = true;
      this.medley.play(false);

      this.logger.info('Playing started');
    }
  }

  pause() {
    if (!this.medley.paused) {
      this._started = false;
      this.medley.togglePause(false);

      this.logger.info('Playing paused');
    }

  }

  async requestAudioStream(options: RequestAudioOptions) {
    return this.medley.requestAudioStream(options);
  }

  deleteAudioStream(streamId: number) {
    this.medley.deleteAudioStream(streamId);
  }

  /** @deprecated Allow direct manipulation */
  updateSequence(sequences: SequenceConfig[]) {
    const crates = sequences.map(
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

    this.addCrates(...crates);
  }

  addCrates(...crates: BoomBoxCrate[]) {
    this.boombox.addCrates(...crates);
  }

  removeCrates(...cratesOrIds: Array<BoomBoxCrate['id'] | BoomBoxCrate>) {
    this.boombox.removeCrates(...cratesOrIds);
  }

  moveCrates(newPosition: number, ...cratesOrIds: Array<BoomBoxCrate['id'] | BoomBoxCrate>) {
    this.boombox.moveCrates(newPosition, ...cratesOrIds);
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

  /** @deprecated Rewrite this */
  updateSweeperRules(configs: SweeperRule[]) {
    const collectPath = () => this.boombox.sweeperInsertionRules.map(r => r.collection.id); // TODO: Store path in metadata

    const oldPaths = collectPath();

    this.boombox.sweeperInsertionRules = configs.map<SweeperInsertionRule>(({ from, to, path }) => {
      if (!this.sweepers.has(path)) {
        const collection = new WatchTrackCollection<BoomBoxTrack>(path).watch(`${normalizePath(path)}/**/*`);
        collection.shuffle();
        this.sweepers.set(path, collection);
      }

      return {
        from,
        to,
        collection: this.sweepers.get(path)!
      }
    });

    const newPaths = collectPath();
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

  async request(trackId: BoomBoxTrack['id'], requestedBy: Audience) {
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

  getRequestsOf(requester: Audience) {
    return this.boombox.getRequestsOf(requester);
  }

  unrequest(requestIds: number[]) {
    return this.boombox.unrequest(requestIds);
  }

  get crateIndex() {
    return this.boombox.crateIndex;
  }

  set crateIndex(newIndex: number) {
    this.boombox.crateIndex = newIndex;
  }

  addAudiences(groupId: AudienceGroupId, audienceId: string, data?: any) {
    if (!this.audiences.has(groupId)) {
      this.audiences.set(groupId, new Map());
    }

    this.audiences.get(groupId)!.set(audienceId, data);
    this.playIfHasAudiences();
  }

  removeAudience(groupId: AudienceGroupId, audienceId: string) {
    this.getAudiences(groupId)?.delete(audienceId);
    return this.pauseIfNoAudiences();
  }

  removeAudiencesForGroup(groupId: AudienceGroupId) {
    this.audiences.delete(groupId);
    return this.pauseIfNoAudiences();
  }

  updateAudiences(groupId: AudienceGroupId, audiences: [id: string, data: any][]) {
    this.audiences.set(groupId, new Map(audiences));
    this.playIfHasAudiences();
  }

  playIfHasAudiences() {
    if (this.playState !== PlayState.Playing && this.hasAudiences) {
      this.start();
    }

    return !this.medley.paused;
  }

  pauseIfNoAudiences() {
    if (this.playState === PlayState.Playing && !this.hasAudiences) {
      this.pause();
    }

    return this.medley.paused;
  }

  getAudiences(groupId: AudienceGroupId) {
    return this.audiences.get(groupId);
  }

  get totalAudiences() {
    const audiences = new Set<string>();

    for (const aud of this.audiences.values()) {
      for (const id of aud.keys()) {
        audiences.add(id);
      }
    }

    return audiences.size;
  }

  get hasAudiences() {
    for (const aud of this.audiences.values()) {
      if (aud.size > 0) {
        return true;
      }
    }

    return false;
  }

  get audienceGroups() {
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

export const makeAudienceGroup = (type: AudienceType, groupId: string): AudienceGroupId => `${type}$${groupId}`;

export const extractAudienceGroup = (id: AudienceGroupId) => {
  const [type, groupId] = id.split('$', 2);
  return {
    type,
    groupId
  }
}

export const makeAudience = curry((type: AudienceType, groupId: string, id: string): Audience => ({
  group: makeAudienceGroup(type, groupId),
  id
}));
