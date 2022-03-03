import { BoomBox,
  BoomBoxCrate,
  BoomBoxEvents,
  BoomBoxTrack,
  BoomBoxTrackPlay,
  Crate,
  decibelsToGain,
  Medley,
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
import _, { difference, isArray } from "lodash";
import { createExciter } from "./exciter";
import { MusicCollectionDescriptor, MusicCollections } from "./music_collections";

export enum PlayState {
  Idle = 'idle',
  Playing = 'playing',
  Paused = 'paused'
}

export type SequenceLimit = number | [max: number] | [min: number, max: number];

function sequenceLimit(limit: SequenceLimit): number | (() => number) {
  if (isArray(limit)) {
    return limit.length === 1
      ? () => _.random(1, limit[0])
      : () => _.random(limit[0], limit[1])

  }

  return limit;
}

export type SequenceConfig = {
  crateId: string;
  collections: { id: string; weight?: number }[];
  limit: SequenceLimit;
};

export type StationOptions = {
  id: string;
  /**
   * Initial audio gain, default to -15dBFS (Appx 0.178)
   * @default -15dBFS
   */
  initialGain?: number;

  musicCollections: MusicCollectionDescriptor[];

  sequences: SequenceConfig[];

  intros?: TrackCollection<BoomBoxTrack>;

  sweeperRules?: SweeperRule[];

  requestSweepers?: TrackCollection<BoomBoxTrack>;
}

export type SweeperConfig = {
  from?: string[];
  to?: string[];
  path: string;
}

export type SweeperRule = SweeperConfig;
export interface StationEvents extends Pick<BoomBoxEvents, 'trackQueued' | 'trackLoaded' | 'trackStarted' | 'trackActive' | 'trackFinished'> {
  requestTrackAdded: (track: TrackPeek<RequestTrack<User['id']>>) => void;
}

export class Station extends (EventEmitter as new () => TypedEventEmitter<StationEvents>) {
  readonly id: string;
  readonly queue: Queue<BoomBoxTrack>;
  readonly medley: Medley<BoomBoxTrack>;

  private boombox: BoomBox<User['id']>;

  readonly collections: MusicCollections;
  private sequences: SequenceConfig[] = [];

  readonly initialGain: number;
  private intros?: TrackCollection<BoomBoxTrack>;
  private requestSweepers?: TrackCollection<BoomBoxTrack>;

  constructor(options: StationOptions) {
    super();

    this.queue = new Queue();
    this.medley = new Medley(this.queue);

    if (this.medley.getAudioDevice().type !== 'Null') {
      this.medley.setAudioDevice({ type: 'Null', device: 'Null Device'});
    }

    // Create boombox
    const boombox = new BoomBox({
      medley: this.medley,
      queue: this.queue,
      crates: []
    });

    boombox.on('trackQueued', this.handleTrackQueued);
    boombox.on('trackLoaded', this.handleTrackLoaded);
    boombox.on('trackStarted', this.handleTrackStarted);
    boombox.on('trackActive', this.handleTrackActive);
    boombox.on('trackFinished', this.handleTrackFinished);
    boombox.on('requestTrackFetched', this.handleRequestTrack);

    this.id = options.id;

    this.boombox = boombox;
    this.collections = new MusicCollections(this, ...(options.musicCollections || []));
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

        if (sweeper && this.medley.isTrackLoadable(sweeper)) {
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
      console.log('Start playing');
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
      bufferSize: 48000 * 0.5,
      buffering: 480 * 4, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
      preFill: 48000 * 0.5, // Pre-fill the stream with at least 500ms of audio, to reduce stuttering while encoding to Opus
      // discord voice only accept 48KHz sample rate, 16 bit per sample
      sampleRate: 48000,
      format: 'Int16LE',
      gain: this.initialGain
    });

    return createExciter(audioRequest);
  }

  updateCollections(newCollections: MusicCollectionDescriptor[]) {
    this.collections.update(newCollections);
    this.createCrates();
  }

  updateSequence(sequences: SequenceConfig[]) {
    this.sequences = [...sequences];
    this.createCrates();
  }

  private createCrates() {
    this.boombox.crates = this.sequences.map(
      ({ crateId, collections, limit }, index) => {
        const validCollections = collections.filter(col => this.collections.has(col.id));

        if (validCollections.length === 0) {
          return;
        }

        return new Crate({
          id: crateId,
          sources: validCollections.map(({ id, weight = 1 }) => ({ collection: this.collections.get(id)!, weight })),
          limit: sequenceLimit(limit)
        });
      })
      .filter((c): c is BoomBoxCrate => c !== undefined);
  }

  private sweepers: Map<string, WatchTrackCollection<BoomBoxTrack>> = new Map();

  updateSweeperRules(configs: SweeperConfig[]) {
    const oldPaths = this.boombox.sweeperInsertionRules.map(r => r.collection.id);

    this.boombox.sweeperInsertionRules = configs.map<SweeperInsertionRule>(({ from, to, path }) => {
      if (!this.sweepers.has(path)) {
        this.sweepers.set(path, WatchTrackCollection.initWithWatch<BoomBoxTrack>(path, path));
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
    return this.collections.findTrackById(id);
  }

  search(q: Record<'artist' | 'title' | 'query', string | null>, limit?: number): BoomBoxTrack[] {
    return this.collections.search(q, limit);
  }

  autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string) {
    return this.collections.autoSuggest(q, field, narrowBy, narrowTerm);
  }

  async request(trackId: BoomBoxTrack['id'], requestedBy: User['id']) {
    const track = this.findTrackById(trackId);
    if (!track) {
      return false;
    }

    if (!this.medley.isTrackLoadable(track)) {
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

  get crateIndex() {
    return this.boombox.crateIndex;
  }

  set crateIndex(newIndex: number) {
    this.boombox.crateIndex = newIndex;
  }
}