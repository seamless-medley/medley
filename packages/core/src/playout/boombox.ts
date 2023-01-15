import { parse as parsePath } from 'path';
import { castArray, flatten, matches, some, toLower, trim, uniq, without } from "lodash";
import { EventEmitter } from "stream";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, EnqueueListener, Queue, TrackPlay, Metadata, CoverAndLyrics, DeckIndex, DeckPositions } from "@seamless-medley/medley";
import { Crate, CrateSequencer, LatchOptions, LatchSession, TrackValidator, TrackVerifier, TrackVerifierResult } from "../crate";
import { Track, TrackExtra } from "../track";
import { TrackCollection, TrackPeek } from "../collections";
import { SweeperInserter } from "./sweeper";
import { createLogger, Logger, type ILogObj } from '../logging';
import { MetadataHelper } from '../metadata';
import { MusicDb } from '../library/music_db';

export type TrackRecord = {
  trackId: string;
  title?: string;
  artists: string[];
  isrc?: string;
}

export enum TrackKind {
  Normal,
  Request,
  Insertion
}

export type BoomBoxTrackExtra = TrackExtra & {
  tags?: Metadata;
  maybeCoverAndLyrics?: Promise<CoverAndLyrics>;
  kind: TrackKind;
}

export type BoomBoxTrack = Track<BoomBoxTrackExtra>;
export type BoomBoxTrackPlay = TrackPlay<BoomBoxTrack>;
export type BoomBoxCrate = Crate<BoomBoxTrack>;

export type RequestTrack<Requester> = BoomBoxTrack & {
  rid: number;
  priority?: number;
  requestedBy: Requester[];
  lastRequestTime?: Date;
  original: BoomBoxTrack; // Store the original track as a RequestTrack is likely to be a clone
}

export type OnInsertRequestTrack<R> = (track: RequestTrack<R>) => Promise<void>;

export function isRequestTrack<T>(o: any): o is RequestTrack<T> {
  return !!o && !!o.requestedBy;
}

export type BoomBoxEvents = {
  sequenceChange: (activeCrate: BoomBoxCrate) => void;
  currentCollectionChange: (oldCollection: TrackCollection<BoomBoxTrack> | undefined, newCollection: TrackCollection<BoomBoxTrack>, trasitingFromRequestTrack: boolean) => void;
  currentCrateChange: (oldCrate: BoomBoxCrate, newCrate: BoomBoxCrate) => void;
  trackQueued: (track: BoomBoxTrack) => void;

  deckLoaded: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;
  deckStarted: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;
  deckActive: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;
  deckFinished: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;
  deckUnloaded: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;


  trackStarted: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => void;
  trackActive: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;
  trackFinished: (deck: DeckIndex, trackPlay: BoomBoxTrackPlay) => void;

  error: (error: Error) => void;
}

type BoomBoxOptions<Requester = any> = {
  id: string;

  medley: Medley<BoomBoxTrack>;
  queue: Queue<BoomBoxTrack>;
  crates: BoomBoxCrate[];

  db?: MusicDb;

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

  onInsertRequestTrack?: OnInsertRequestTrack<Requester>;
}

export type DeckInfo = {
  trackPlay?: BoomBoxTrackPlay;
  playing: boolean;
  active: boolean;
}

export type DeckInfoWithPositions = DeckInfo & {
  positions: DeckPositions;
}

export class BoomBox<Requester = any> extends (EventEmitter as new () => TypedEventEmitter<BoomBoxEvents>) {
  readonly id: string;

  readonly sequencer: CrateSequencer<BoomBoxTrack>;
  private readonly sweeperInserter: SweeperInserter;

  options: Required<Pick<BoomBoxOptions<Requester>, 'noDuplicatedArtist' | 'duplicationSimilarity'>>;

  private decks = Array(3).fill(0).map<DeckInfo>(() => ({ playing: false, active: false })) as [DeckInfo, DeckInfo, DeckInfo];

  readonly medley: Medley<BoomBoxTrack>;
  readonly queue: Queue<BoomBoxTrack>;

  readonly musicDb?: MusicDb;

  private readonly onInsertRequestTrack?: OnInsertRequestTrack<Requester>;

  artistHistory: string[][] = [];

  private logger: Logger<ILogObj>;

  constructor(options: BoomBoxOptions<Requester>) {
    super();
    //
    this.id = options.id;
    this.logger = createLogger({
      name: `boombox/${this.id}`
    });

    this.options = {
      noDuplicatedArtist: options.noDuplicatedArtist || 50,
      duplicationSimilarity: options.duplicationSimilarity || 0.8
    };
    //
    this.medley = options.medley;
    this.queue = options.queue;
    //
    this.medley.on('enqueueNext', this.enqueue);
    this.medley.on('loaded', this.deckLoaded);
    this.medley.on('unloaded', this.deckUnloaded);
    this.medley.on('started', this.deckStarted);
    this.medley.on('finished', this.deckFinished);
    this.medley.on('mainDeckChanged', this.mainDeckChanged);

    this.onInsertRequestTrack = options.onInsertRequestTrack;

    //
    this.sequencer = new CrateSequencer<BoomBoxTrack>(this.id, options.crates, {
      trackValidator: this.isTrackLoadable,
      trackVerifier: this.verifyTrack
    });

    this.sequencer.on('change', (crate: BoomBoxCrate) => this.emit('sequenceChange', crate));
    this.sequencer.on('rescue', (scanned, ignored) => {
      const n = Math.max(1, Math.min(ignored, scanned) - 1);
      this.logger.debug('Rescue, removing', n, 'artist history entries');
      this.artistHistory = this.artistHistory.slice(n);
    });

    this.sweeperInserter = new SweeperInserter(this, []);
  }


  get sweeperInsertionRules() {
    return this.sweeperInserter.rules;
  }

  set sweeperInsertionRules(rules) {
    this.sweeperInserter.rules = rules;
  }

  private _currentCrate: BoomBoxCrate | undefined;
  private _currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;
  private _inTransition = false;

  /**
   * Current crate
   */
  get crate() {
    return this._currentCrate;
  }

  get trackPlay() {
    return this._currentTrackPlay;
  }

  get isInTransition() {
    return this._inTransition;
  }

  getDeckPositions(index: DeckIndex): DeckPositions {
    return this.medley.getDeckPositions(index);
  }

  getDeckInfo(index: DeckIndex): Readonly<DeckInfoWithPositions> {
    const positions = this.medley.getDeckPositions(index);

    return {
      ...this.decks[index],
      positions
    }
  }

  private requests: TrackCollection<RequestTrack<Requester>> = new TrackCollection('$_requests', undefined);

  private isTrackLoadable: TrackValidator = async (path) => trackHelper.isTrackLoadable(path);

  private verifyTrack: TrackVerifier<BoomBoxTrackExtra> = async (track): Promise<TrackVerifierResult<BoomBoxTrackExtra>> => {
    try {
      const metadata = track.extra?.tags ?? (await helper.fetchMetadata(track, this.musicDb, true)).metadata;

      const boombooxExtra: BoomBoxTrackExtra = {
        kind: TrackKind.Normal,
        ...track.extra,
        tags: metadata
      }

      const playedArtists = flatten(this.artistHistory).map(toLower);
      const currentArtists = getArtists(boombooxExtra).map(toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));

      return {
        shouldPlay: !dup,
        extra: !dup ? boombooxExtra : undefined
      }
    }
    catch (e: unknown) {
      this.logger.debug('Error in verifyTrack()', (e as Error).message);
    }

    return {
      shouldPlay: true,
      extra: track.extra
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

    requested.extra = {
      ...requested.extra,
      kind: TrackKind.Request
    }

    return {
      index: this.requests.push(requested),
      track: requested
    }
  }

  sortRequests() {
    this.requests.sort(t => -(t.priority || 0), t => (t.lastRequestTime?.valueOf() || 0));
  }

  // TODO: Rename this to a new better name
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

  getRequestsOf(requester: Requester) {
    const matchRequester = matches(requester);
    return this.requests.all().filter(r => r.requestedBy.some(matchRequester));
  }

  unrequest(requestIds: number[]) {
    const all = new Set(requestIds);
    const removed = this.requests.removeBy(r => all.has(r.rid));
    return {
      removed,
      invalid: without(requestIds, ...removed.map(r => r.rid))
    }
  }

  private enqueue: EnqueueListener = async (done) => {
    if (this.queue.length > 0) {
      done(true);
    }

    try {
      const addToQueue = (track: BoomBoxTrack) => {
        this.queue.add(track);
        this.emit('trackQueued', track);
        done(true);
      }

      const requestedTrack = await this.fetchRequestTrack();
      if (requestedTrack) {
        await this.onInsertRequestTrack?.(requestedTrack);
        addToQueue(requestedTrack);
        return;
      }

      const nextTrack = await this.sequencer.nextTrack();

      if (!nextTrack) {
        done(false);
        return;
      }

      const currentTrack = this._currentTrackPlay?.track;
      const currentCollection = currentTrack?.collection;
      const nextCollection = nextTrack.collection;
      const collectionChange = currentCollection?.id !== nextCollection.id;

      if (collectionChange && nextCollection) {
        const trasitingFromRequestTrack = isRequestTrack(currentTrack) && !isRequestTrack(nextTrack);
        this.emit('currentCollectionChange', currentCollection, nextCollection, trasitingFromRequestTrack);
      }

      if (this._currentCrate !== nextTrack.sequencing.crate) {

        if (this._currentCrate && nextTrack.sequencing.crate) {
          this.emit('currentCrateChange', this._currentCrate, nextTrack.sequencing.crate);
        }

        this._currentCrate = nextTrack.sequencing.crate;
      }

      addToQueue(nextTrack);
      return;
    }
    catch (e) {
      this.emit('error', e as Error);
    }

    done(false);
  }

  private deckLoaded: DeckListener<BoomBoxTrack> = async (deck, trackPlay) => {
    this.decks[deck] = {
      trackPlay,
      playing: false,
      active: false
    }

    // build cover and lyrics metadata
    const trackFromCollection = trackPlay.track.collection.fromId(trackPlay.track.id);
    const track = trackFromCollection ?? trackPlay.track;

    const { extra } = track;

    if (extra && extra.kind !== TrackKind.Insertion) {
      if (!extra.maybeCoverAndLyrics) {
        extra.maybeCoverAndLyrics = helper.coverAndLyrics(trackPlay.track.path);
      }

      if (isRequestTrack(track) && !track.original.extra?.maybeCoverAndLyrics) {
        track.original.extra = {
          ...extra,
          kind: TrackKind.Normal
        };
      }
    }

    this.emit('deckLoaded', deck, trackPlay);
  }

  private deckUnloaded: DeckListener<BoomBoxTrack> = async (deck, trackPlay) => {
    this.decks[deck] = {
      trackPlay: undefined,
      playing: false,
      active: false
    }

    // clean up memory holding the cover, lyrics and extra
    if (trackPlay.track?.extra) {
      trackPlay.track.extra.maybeCoverAndLyrics = undefined;

      if (isRequestTrack(trackPlay.track) && trackPlay.track.original.extra?.maybeCoverAndLyrics) {
        trackPlay.track.original.extra.maybeCoverAndLyrics = undefined;
      }
    }

    this.emit('deckUnloaded', deck, trackPlay);
  }

  private deckStarted: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    this.decks[deck].playing = true;

    const kind = trackPlay.track.extra?.kind;

    this._inTransition = kind === TrackKind.Insertion;

    this.emit('deckStarted', deck, trackPlay);

    if (kind === TrackKind.Insertion) {
      return;
    }

    if (kind === undefined) {
      return;
    }

    if (this._currentTrackPlay?.uuid === trackPlay.uuid) {
      return;
    }

    const lastTrack = this._currentTrackPlay;
    this._currentTrackPlay = trackPlay;

    this.emit('trackStarted', deck, trackPlay, lastTrack);

    const { noDuplicatedArtist } = this.options;

    if (noDuplicatedArtist) {
      const { extra } = trackPlay.track;
      if (extra) {
        this.artistHistory.push(getArtists(extra));
        this.artistHistory = this.artistHistory.splice(-noDuplicatedArtist);
      }
    }
  }

  private deckFinished: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    this.decks[deck].playing = false;

    this.emit('deckFinished', deck, trackPlay);

    const kind = trackPlay.track.extra?.kind;

    if (kind !== TrackKind.Insertion) {
      this.emit('trackFinished', deck, trackPlay);
      return;
    }
  }

  private mainDeckChanged: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    this.decks[deck].active = true;
    for (let i = 0; i < 3; i++) {
      if (i !== deck) {
        this.decks[i].active = false;
      }
    }

    this.emit('deckActive', deck, trackPlay);

    const kind = trackPlay.track.extra?.kind;

    if (kind !== TrackKind.Insertion) {
      this.emit('trackActive', deck, trackPlay);
    }
  }

  /**
   * All creates
   */
  get crates() {
    return this.sequencer.crates;
  }

  addCrates(...crates: BoomBoxCrate[]) {
    this.sequencer.addCrates(...crates);
  }

  removeCrates(...cratesOrIds: Array<BoomBoxCrate['id'] | BoomBoxCrate>) {
    this.sequencer.removeCrates(...cratesOrIds);
  }

  moveCrates(newPosition: number, ...cratesOrIds: Array<BoomBoxCrate['id'] | BoomBoxCrate>) {
    this.sequencer.moveCrates(newPosition, ...cratesOrIds);
  }

  getCrateIndex() {
    return this.sequencer.getCrateIndex();
  }

  setCrateIndex(newIndex: number) {
    this.sequencer.setCrateIndex(newIndex, true);
  }

  increasePlayCount() {
    return this.sequencer.increasePlayCount();
  }

  latch(options?: LatchOptions<BoomBoxTrack>) {
    return this.sequencer.latch(options);
  }

  isKnownCollection(collection: TrackCollection<BoomBoxTrack>): boolean {
    return this.sequencer.isKnownCollection(collection);
  }

  get isLatchActive(): boolean {
    return this.sequencer.getActiveLatch() !== undefined;
  }

  get allLatches(): LatchSession<BoomBoxTrack>[] {
    return this.sequencer.allLatches;
  }
}

const extractArtists = (artists: string) => uniq(artists.split(/[/;,]/)).map(trim);

export function getArtists(extra?: BoomBoxTrackExtra): string[] {
  if (!extra?.tags?.artist) {
    return [];
  }

  return extractArtists(extra.tags.artist);
}

export function getTrackBanner(track: BoomBoxTrack) {
  const tags = track.extra?.tags;
  const info = formatSongBanner(getArtists(track.extra), tags?.title);
  return info ? info : parsePath(track.path).name;
}

export function formatSongBanner(artists: string[] | string | undefined, title: string | undefined): string | undefined {
  const info: string[] = [];

  if (artists) {
    info.push(castArray(artists).join(','));
  }

  if (title) {
    info.push(title);
  }

  return info.length ? info.join(' - ') : undefined;
}

export function trackRecordOf(track: BoomBoxTrack): TrackRecord {
  const { extra } = track;

  return {
    trackId: track.id,
    title: extra?.tags?.title,
    artists: extra ? getArtists(extra) : [],
    isrc: extra?.tags?.isrc
  }
}

const trackHelper = new MetadataHelper();
const helper = new MetadataHelper();
