import { parse as parsePath } from 'path';
import _, { flatten, some, toLower, trim, uniq } from "lodash";
import { EventEmitter } from "stream";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, EnqueueListener, Queue, TrackPlay, Metadata, CoverAndLyrics } from "@seamless-medley/medley";
import { Crate, CrateSequencer, TrackValidator, TrackVerifier } from "../crate";
import { Track } from "../track";
import { TrackCollection, TrackPeek } from "../collections";
import { SweeperInserter } from "./sweeper";
import { MetadataHelper, MetadataCache } from './metadata';

export enum TrackKind {
  Normal,
  Request,
  Insertion
}

export type BoomBoxMetadata = {
  tags?: Metadata;
  coverAndLyrics?: CoverAndLyrics;
  kind: TrackKind;
}

export type BoomBoxTrack = Track<BoomBoxMetadata>;
export type BoomBoxTrackPlay = TrackPlay<BoomBoxTrack>;
export type BoomBoxCrate = Crate<BoomBoxTrack>;

export type TrackRecord = {
  trackPlay: BoomBoxTrackPlay;
  playedTime: Date;
}

export type RequestTrack<Requester> = BoomBoxTrack & {
  rid: number;
  priority?: number;
  requestedBy: Requester[];
  lastRequestTime?: Date;
  original: BoomBoxTrack; // Store the original track as a RequestTrack is likely to be a shallow
}

export function isRequestTrack<T>(o: any): o is RequestTrack<T> {
  return o && !!o.requestedBy;
}

export interface BoomBoxEvents {
  sequenceChange: (activeCrate: BoomBoxCrate) => void;
  currentCollectionChange: (oldCollection: TrackCollection<BoomBoxTrack>, newCollection: TrackCollection<BoomBoxTrack>) => void;
  currentCrateChange: (oldCrate: BoomBoxCrate, newCrate: BoomBoxCrate) => void;
  trackQueued: (track: BoomBoxTrack) => void;
  trackLoaded: (trackPlay: BoomBoxTrackPlay) => void;
  trackUnloaded: (trackPlay: BoomBoxTrackPlay) => void;
  trackStarted: (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => void;
  trackActive: (trackPlay: BoomBoxTrackPlay) => void;
  trackFinished: (trackPlay: BoomBoxTrackPlay) => void;
  requestTrackFetched: (track: RequestTrack<any>) => void;
  error: (error: Error) => void;
}

type BoomBoxOptions = {
  medley: Medley<BoomBoxTrack>;
  queue: Queue<BoomBoxTrack>;
  crates: BoomBoxCrate[];

  metadataCache?: MetadataCache;

  /**
   * Initalize artist history
   */
  artistHistory?: string[][];

  /**
   * Number of maximum track history
   * @default 20
   */
  maxTrackHistory?: number;

  /**
   * Number of tracks to be kept to be check for duplication
   * Default value is 50
   * `false` means no duplication check should be done
   *
   * @default 50
   */
  noDuplicatedArtist?: number | false;

  /**
   * Similarity threshold for the artist to be considered as dupplicated
   *
   * @default 0.8
   */
  duplicationSimilarity?: number;

}

export class BoomBox<Requester = any> extends (EventEmitter as new () => TypedEventEmitter<BoomBoxEvents>) {
  readonly sequencer: CrateSequencer<BoomBoxTrack>;

  readonly options: Required<Pick<BoomBoxOptions, 'maxTrackHistory' | 'noDuplicatedArtist' | 'duplicationSimilarity'>>;

  readonly medley: Medley<BoomBoxTrack>;
  readonly queue: Queue<BoomBoxTrack>;
  readonly metadataCache?: MetadataCache;

  private artistHistory: string[][];

  readonly trackHistory: TrackRecord[] = [];

  constructor(options: BoomBoxOptions) {
    super();
    //
    this.options = {
      noDuplicatedArtist: options.noDuplicatedArtist || 50,
      duplicationSimilarity: options.duplicationSimilarity || 0.8,
      maxTrackHistory: options.maxTrackHistory || 20
    };
    //
    this.artistHistory = [...options.artistHistory || []];
    //
    this.medley = options.medley;
    this.queue = options.queue;
    this.metadataCache = options.metadataCache;
    //
    this.medley.on('enqueueNext', this.enqueue);
    this.medley.on('loaded', this.deckLoaded);
    this.medley.on('unloaded', this.deckUnloaded);
    this.medley.on('started', this.deckStarted);
    this.medley.on('finished', this.deckFinished);
    this.medley.on('mainDeckChanged', this.mainDeckChanged);
    //
    this.sequencer = new CrateSequencer<BoomBoxTrack>(options.crates, {
      trackValidator: this.isTrackLoadable,
      trackVerifier: this.verifyTrack
    });

    this.sequencer.on('change', (crate: BoomBoxCrate) => this.emit('sequenceChange', crate));
    this.sequencer.on('rescue', (scanned, ignored) => {
      const n = Math.max(1, Math.min(ignored, scanned) - 1);
      this.artistHistory = this.artistHistory.slice(n);
    });
  }

  private sweeperInserter: SweeperInserter = new SweeperInserter(this, []);

  get sweeperInsertionRules() {
    return this.sweeperInserter.rules;
  }

  set sweeperInsertionRules(rules) {
    this.sweeperInserter.rules = rules;
  }

  private _currentCrate: BoomBoxCrate | undefined;
  private _currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

  get crate() {
    return this._currentCrate;
  }

  get trackPlay() {
    return this._currentTrackPlay;
  }

  private requests: TrackCollection<RequestTrack<Requester>> = new TrackCollection('$_requests');

  private isTrackLoadable: TrackValidator = async (path) => this.medley.isTrackLoadable(path);

  private verifyTrack: TrackVerifier<BoomBoxMetadata> = async (track) => {
    try {
      const musicMetadata = track.metadata?.tags ?? (await MetadataHelper.fetchMetadata(track, this.metadataCache, true)).metadata;

      const boomBoxMetadata: BoomBoxMetadata = {
        kind: TrackKind.Normal,
        ...track.metadata,
        tags: musicMetadata
      }

      const playedArtists = flatten(this.artistHistory).map(toLower);
      const currentArtists = getArtists(boomBoxMetadata).map(toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));

      return {
        shouldPlay: !dup,
        metadata: !dup ? boomBoxMetadata : undefined
      }
    }
    catch {

    }

    return {
      shouldPlay: true,
      metadata: undefined
    };
  }

  private _lastRequestId = 0;

  request(track: BoomBoxTrack, requestedBy?: Requester): TrackPeek<RequestTrack<Requester>> {
    const existing = this.requests.fromId(track.id);

    if (existing) {
      existing.priority = (existing.priority || 0) + 1;
      existing.lastRequestTime = new Date();

      if (requestedBy) {
        existing.requestedBy.push(requestedBy)
      }

      this.sortRequests();

      return {
        index: this.requests.indexOf(existing),
        track: existing
      }
    }

    // This is a shallow copy
    const requested: RequestTrack<Requester> = {
      ...track,
      original: track,
      rid: ++this._lastRequestId,
      priority: 0,
      requestedBy: requestedBy ? [requestedBy]: [],
      lastRequestTime: new Date()
    };

    requested.metadata = {
      ...requested.metadata,
      kind: TrackKind.Request
    }

    const index = this.requests.push(requested);
    return {
      index,
      track: requested
    }
  }

  sortRequests() {
    this.requests.sort(t => -(t.priority || 0), t => (t.lastRequestTime?.valueOf() || 0));
  }

  private _requestsEnabled = true;

  get requestsEnabled() {
    return this._requestsEnabled;
  }

  set requestsEnabled(value: boolean) {
    this._requestsEnabled = value;
  }

  get requestsCount() {
    return this.requests.length;
  }

  private async fetchRequestTrack(): Promise<RequestTrack<Requester> | undefined> {
    while (this._requestsEnabled && this.requests.length) {
      const track = this.requests.shift()!;

      if (await this.isTrackLoadable(track.path)) {
        return track;
      }
    }

    return undefined;
  }

  peekRequests(from: number, n: number) {
    return this.requests.peek(from, n);
  }

  private enqueue: EnqueueListener = async (done) => {
    if (this.queue.length > 0) {
      done(true);
    }

    try {
      const requestedTrack = await this.fetchRequestTrack();
      if (requestedTrack) {
        this.emit('requestTrackFetched', requestedTrack);

        this.queue.add(requestedTrack);
        done(true);
        return;
      }

      const nextTrack = await this.sequencer.nextTrack();

      if (!nextTrack) {
        done(false);
        return;
      }

      const currentCollection = this._currentTrackPlay?.track.collection;
      const nextCollection = nextTrack.collection;

      if (currentCollection && nextCollection && currentCollection.id !== nextCollection.id) {
        this.emit('currentCollectionChange', currentCollection, nextCollection);
      }

      if (this._currentCrate !== nextTrack.crate) {

        if (this._currentCrate && nextTrack.crate) {
          this.emit('currentCrateChange', this._currentCrate, nextTrack.crate);
        }

        this._currentCrate = nextTrack.crate;
      }

      this.queue.add(nextTrack);

      this.emit('trackQueued', nextTrack);
      done(true);
      return;
    }
    catch (e) {
      this.emit('error', e as Error);
    }

    done(false);
  }

  private deckLoaded: DeckListener<BoomBoxTrack> = async (deck, trackPlay) => {
    // build cover and lyrics metadata
    const { track } = trackPlay;
    const { metadata } = track;

    if (metadata && metadata.kind !== TrackKind.Insertion) {
      if (!metadata.coverAndLyrics) {
        metadata.coverAndLyrics = await MetadataHelper.coverAndLyrics(trackPlay.track.path);
      }

      if (isRequestTrack(track) && !track.original.metadata?.coverAndLyrics) {
        track.original.metadata = {
          ...metadata,
          kind: TrackKind.Normal
        };
      }
    }

    this.emit('trackLoaded', trackPlay);
  }

  private deckUnloaded: DeckListener<BoomBoxTrack> = async (deck, trackPlay) => {
    // clean up memory holding the cover and lyrics
    if (trackPlay.track?.metadata) {
      trackPlay.track.metadata.coverAndLyrics = undefined;

      if (isRequestTrack(trackPlay.track) && trackPlay.track.original.metadata?.coverAndLyrics) {
        trackPlay.track.original.metadata.coverAndLyrics = undefined;
      }
    }

    this.emit('trackUnloaded', trackPlay);
  }

  private deckStarted: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    const kind = trackPlay.track.metadata?.kind;

    if (kind === undefined || kind === TrackKind.Insertion) {
      return;
    }

    if (this._currentTrackPlay?.uuid === trackPlay.uuid) {
      return;
    }

    const lastTrack = this._currentTrackPlay;
    this._currentTrackPlay = trackPlay;

    this.emit('trackStarted', trackPlay, lastTrack);

    const { maxTrackHistory, noDuplicatedArtist } = this.options;

    if (maxTrackHistory > 0) {
      this.trackHistory.push({
        trackPlay,
        playedTime: new Date()
      });

      while (this.trackHistory.length > maxTrackHistory) {
        this.trackHistory.shift();
      }
    }

    if (noDuplicatedArtist > 0) {
      const { metadata } = trackPlay.track;
      if (metadata) {
        this.artistHistory.push(getArtists(metadata));

        while (this.artistHistory.length > noDuplicatedArtist) {
          this.artistHistory.shift();
        }
      }
    }
  }

  private deckFinished: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    this.emit('trackFinished', trackPlay);
  }

  private mainDeckChanged: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    this.emit('trackActive', trackPlay);
  }

  get crates() {
    return this.sequencer.crates;
  }

  set crates(value: BoomBoxCrate[]) {
    this.sequencer.crates = value;
  }

  get crateIndex() {
    return this.sequencer.crateIndex;
  }

  set crateIndex(newIndex: number) {
    this.sequencer.crateIndex = newIndex;
  }
}

function getArtists(metadata: BoomBoxMetadata): string[] {
  if (!metadata.tags) {
    return [];
  }

  return uniq(metadata.tags.artist.split(/[/;,]/)).map(trim);
}

export function getTrackBanner(track: BoomBoxTrack) {
  const tags = track.metadata?.tags;
  const info: string[] = [];

  if (tags?.artist) {
    info.push(tags.artist);
  }

  if (tags?.title) {
    info.push(tags.title);
  }

  return info.length ? info.join(' - ') : parsePath(track.path).name;
}
