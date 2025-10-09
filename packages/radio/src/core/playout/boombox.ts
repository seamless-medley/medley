import { parse as parsePath } from 'node:path';
import { chain, flatten, isEqual, mapValues, matches, reject, some, toLower, uniq, without } from "lodash";
import { isString } from 'lodash/fp';
import { TypedEmitter } from "tiny-typed-emitter";
import { createLogger, type Logger } from '../../logging';
import { extractArtists, formatTags } from '@seamless-medley/utils';
import type { DeckListener, Medley, EnqueueListener, Queue, TrackPlay, Metadata, CoverAndLyrics, DeckIndex, DeckPositions, AudioProperties } from "@seamless-medley/medley";
import { Crate, CrateSequencer, LatchOptions, LatchSession, TrackValidator, TrackVerifier, TrackVerifierResult } from "../crate";
import { Track, TrackExtra } from "../track";
import { TrackCollection, TrackIndex, WatchTrackCollection } from "../collections";
import { SweeperInserter } from "./sweeper";
import { MetadataHelper } from '../metadata';
import { MusicDb } from '../library/music_db';
import { CrateProfile, CrateProfileBook } from '../crate/profile';
import { stringSimilarity } from '../utils';

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

export type LyricSource = {
  text: string;
  href?: string
}

export type BoomBoxCoverAnyLyrics = CoverAndLyrics & {
  lyricsSource: LyricSource;
}

export type BoomBoxTrackExtra = TrackExtra & {
  tags?: Metadata;
  maybeAudioProperties?: Promise<AudioProperties>;
  maybeCoverAndLyrics?: Promise<BoomBoxCoverAnyLyrics>;
  kind: TrackKind;
  timestamp?: number;
}

export type BoomBoxTrack = Track<BoomBoxTrackExtra>;
export type BoomBoxTrackPlay = TrackPlay<BoomBoxTrack>;
export type BoomBoxCrate = Crate<BoomBoxTrack>;
export type BoomBoxTrackCollection = TrackCollection<BoomBoxTrack>;

type BaseRequester = {

};

export type TrackWithRequester<T extends BoomBoxTrack, R extends BaseRequester> = T & {
  rid: number;
  priority?: number;
  requestedBy: R[];
  firstRequestTime?: Date;
  original: T; // Store the original track as a RequestTrack is likely to be a clone
}

export type OnInsertRequestTrack<T extends BoomBoxTrack, R extends BaseRequester> = (track: TrackWithRequester<T, R>) => Promise<number>;

export function isRequestTrack<T extends BoomBoxTrack, R extends BaseRequester>(o: any): o is TrackWithRequester<T, R> {
  return !!o && !!o.requestedBy;
}

export type BoomBoxProfile = CrateProfile<BoomBoxTrack>;

export type BoomBoxCollectionChangeEvent = {
  oldCollection?: BoomBoxTrackCollection;
  newCollection: BoomBoxTrackCollection;
  fromReqeustTrack: boolean;
  toReqeustTrack: boolean;
  preventSweepers: boolean;
}

export type BoomBoxEvents<P extends BoomBoxProfile = BoomBoxProfile> = {
  /**
   * Emit when the active crate was changed by the sequencer during the sequencing phase
   */
  sequenceChange: (activeCrate: BoomBoxCrate, oldCrate?: BoomBoxCrate) => void;

  sequenceProfileChange: (oldProfile: P | undefined, newProfile: P) => void;

  /**
   * Emit when the active collection was changed by any means during track queuing phase
   *
   * This event is triggered by node-medley itself
   *
   * To detect change during the actual playback, listen to `trackStarted` event and check the collection from trackPlay instead
   */
  collectionChange: (event: BoomBoxCollectionChangeEvent) => void;

  /**
   * Emit when the active profile was changed during track queuing phase
   */
  profileChange: (oldProfile: P | undefined, newProfile: P) => void;

  latchCreated: (session: LatchSession<BoomBoxTrack, BoomBoxTrackExtra>) => void;

  /**
   * Emit when the active crate was changed by any means during track queuing phase
   *
   * Note that this is not the same as `sequenceChange` event
   * This event is triggered by node-medley itself
   */
  crateChange: (oldCrate: BoomBoxCrate | undefined, newCrate: BoomBoxCrate) => void;

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

type BoomBoxOptions<T extends BoomBoxTrack, R extends BaseRequester> = {
  id: string;

  medley: Medley<BoomBoxTrack>;
  queue: Queue<BoomBoxTrack>;

  db?: MusicDb;

  /**
   * Number of last tracks used to check for duplicated artists
   * Default value is 50
   * `false` means no duplication check should be done
   *
   * @default 50
   */
  artistBacklog?: number | false;

  /**
   * Similarity threshold for the artist to be considered as duplicated
   *
   * @default 0.48
   */
  duplicationSimilarity?: number;

  onInsertRequestTrack?: OnInsertRequestTrack<T, R>;
}

export type DeckInfo = {
  trackPlay?: BoomBoxTrackPlay;
  playing: boolean;
  active: boolean;
}

export type DeckInfoWithPositions = DeckInfo & {
  positions: DeckPositions;
}

export type RequestTrackLockPredicate<R extends BaseRequester> = (t: TrackWithRequester<BoomBoxTrack, R>) => boolean;

export class BoomBox<R extends BaseRequester, P extends BoomBoxProfile = CrateProfile<BoomBoxTrack>> extends TypedEmitter<BoomBoxEvents<P>> {
  readonly id: string;

  readonly #sequencer: CrateSequencer<BoomBoxTrack, BoomBoxTrackExtra, P>;
  readonly #sweeperInserter: SweeperInserter;

  options: Required<Pick<BoomBoxOptions<BoomBoxTrack, R>, 'artistBacklog' | 'duplicationSimilarity'>>;

  #decks = Array(3).fill(0).map<DeckInfo>(() => ({ playing: false, active: false })) as [DeckInfo, DeckInfo, DeckInfo];

  readonly medley: Medley<BoomBoxTrack>;
  readonly queue: Queue<BoomBoxTrack>;

  readonly musicDb?: MusicDb;

  readonly #onInsertRequestTrack?: OnInsertRequestTrack<BoomBoxTrack, R>;

  readonly #profileBook = new CrateProfileBook<P>();

  artistHistory: Array<string[]> = [];

  #logger: Logger;

  constructor(options: BoomBoxOptions<BoomBoxTrack, R>) {
    super();
    //
    this.id = options.id;
    this.#logger = createLogger({
      name: 'boombox',
      id: this.id
    });

    this.options = {
      artistBacklog: options.artistBacklog || 50,
      duplicationSimilarity: options.duplicationSimilarity || 0.48
    };
    //
    this.medley = options.medley;
    this.queue = options.queue;
    //
    this.medley.on('enqueueNext', this.#enqueue);
    this.medley.on('loaded', this.#deckLoaded);
    this.medley.on('unloaded', this.#deckUnloaded);
    this.medley.on('started', this.#deckStarted);
    this.medley.on('finished', this.#deckFinished);
    this.medley.on('mainDeckChanged', this.#mainDeckChanged);

    this.#onInsertRequestTrack = options.onInsertRequestTrack;

    //
    this.#sequencer = new CrateSequencer<BoomBoxTrack, BoomBoxTrackExtra, P>(this.id, {
      trackValidator: this.#isTrackLoadable,
      trackVerifier: this.#verifyTrack
    });

    this.#sequencer.on('change', (crate: BoomBoxCrate, oldCrate?: BoomBoxCrate) => this.emit('sequenceChange', crate, oldCrate));
    this.#sequencer.on('profileChange', (oldProfile, newProfile) => this.emit('sequenceProfileChange', oldProfile, newProfile));
    this.#sequencer.on('latchCreated', session => this.emit('latchCreated', session));
    this.#sequencer.on('rescue', (scanned, ignored) => {
      const n = Math.max(1, Math.min(ignored, scanned) - 1);
      this.#logger.warn(`Rescue, removing ${n} artist history entries`);
      this.artistHistory = this.artistHistory.slice(n);

      if (!this.medley.playing && !this.medley.paused) {
        this.#logger.warn('Rescued, but playback was stalled, starting again...');
        this.medley.play();
      }
    });

    this.#sweeperInserter = new SweeperInserter(this, []);
  }


  get sweeperInsertionRules() {
    return this.#sweeperInserter.rules;
  }

  set sweeperInsertionRules(rules) {
    this.#sweeperInserter.rules = rules;
  }

  #currentCrate?: BoomBoxCrate;
  #currentTrackPlay?: BoomBoxTrackPlay;
  #inTransition = false;

  get profileBook() {
    return this.#profileBook;
  }

  get currentCrate() {
    return this.#currentCrate;
  }

  get trackPlay() {
    return this.#currentTrackPlay;
  }

  get isInTransition() {
    return this.#inTransition;
  }

  getDeckPositions(index: DeckIndex): DeckPositions {
    if (!this.#decks[index].trackPlay) {
      return {};
    }

    return this.medley.getDeckPositions(index);
  }

  getDeckInfo(index: DeckIndex): Readonly<DeckInfoWithPositions> {
    const positions = this.getDeckPositions(index);

    return {
      ...this.#decks[index],
      positions
    }
  }

  get activeDeck(): DeckIndex | undefined {
    const index = this.#decks.findIndex(d => d.active);
    return index !== -1 ? index : undefined;
  }

  #requests = new WatchTrackCollection<TrackWithRequester<BoomBoxTrack, R>>('$_requests', undefined);

  #isTrackLoadable: TrackValidator = async (path) => MetadataHelper.for(`boombox-${this.id}`, helper => helper.isTrackLoadable(path, 1000));

  #verifyTrack: TrackVerifier<BoomBoxTrackExtra> = async (track): Promise<TrackVerifierResult<BoomBoxTrackExtra>> => {
    try {
      let timestamp: number | undefined;
      let tags: Metadata;

      if (track.extra?.tags) {
        timestamp = track.extra.timestamp;
        tags = track.extra?.tags;
      } else {
        const fetched = await MetadataHelper.for(`boombox-${this.id}`, helper => helper.fetchMetadata(track, this.musicDb, true));
        timestamp = fetched.timestamp;
        tags = fetched.metadata;
      }

      const boomboxExtra: BoomBoxTrackExtra = {
        kind: TrackKind.Normal,
        ...track.extra,
        tags,
        timestamp
      }

      const playedArtists = flatten(this.artistHistory).map(toLower);
      const currentArtists = getArtistStrings(boomboxExtra).map(toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => stringSimilarity(a, b) >= this.options.duplicationSimilarity));

      if (dup) {
        this.#logger.info('Duplicated artist, deny playing track %s', track.path);
      }

      return {
        shouldPlay: !dup,
        extra: !dup ? boomboxExtra : undefined
      }
    }
    catch (e: unknown) {
      this.#logger.error(e, 'Error in verifyTrack()');
    }

    return {
      shouldPlay: true,
      extra: track.extra
    };
  }

  #lastRequestId = 0;

  async request(track: BoomBoxTrack, requestedBy?: R): Promise<TrackIndex<TrackWithRequester<BoomBoxTrack, R>> | undefined> {
    const existing = this.#requests.fromTrack(track);

    if (existing) {
      existing.priority = (existing.priority || 0) + 1;

      if (requestedBy) {
        const existingRequester = existing.requestedBy.find(r => isEqual(r, requestedBy));

        if (existingRequester === undefined) {
          existing.requestedBy.push(requestedBy);
        }
      }

      this.sortRequests();

      return {
        index: this.#requests.indexOf(existing),
        track: existing
      }
    }

    const loadable = await this.#isTrackLoadable(track.path);

    if (!loadable) {
      this.#logger.warn({ path: track.path }, 'Could not make a request, track is not loadable');
      return;
    }

    // This is a shallow copy
    const requested: TrackWithRequester<BoomBoxTrack, R> = {
      ...track,
      sequencing: undefined,
      original: track,
      rid: ++this.#lastRequestId,
      priority: 0,
      requestedBy: requestedBy ? [requestedBy]: [],
      firstRequestTime: new Date()
    };

    requested.extra = {
      ...requested.extra,
      kind: TrackKind.Request
    }

    return {
      index: this.#requests.push(requested),
      track: requested
    }
  }

  sortRequests(scopedBy?: (t: TrackWithRequester<BoomBoxTrack, R>) => string[]) {
    const sortFuncs: Array<(t: TrackWithRequester<BoomBoxTrack, R>) => number> = [
      t => -(t.priority || 0),
      t => (t.firstRequestTime?.valueOf() || 0)
    ];

    if (!scopedBy) {
      this.#requests.sort(sortFuncs);
      return;
    }

    const scopes = uniq(this.#requests.all().flatMap(scopedBy));
    for (const [index, scope] of scopes.entries()) {
      this.#requests.sort(
        sortFuncs,
        t => scopedBy(t).includes(scope),
        index === scopes.length - 1
      );
    }
  }

  #requestLockPredicates = new Set<RequestTrackLockPredicate<R>>();

  lockRequests(by: RequestTrackLockPredicate<R>) {
    this.#requestLockPredicates.add(by);
  }

  unlockRequests(by: RequestTrackLockPredicate<R>): boolean {
    return this.#requestLockPredicates.delete(by);
  }

  get requestsCount() {
    return this.#requests.length;
  }

  async #fetchRequestTrack(): Promise<TrackWithRequester<BoomBoxTrack, R> | undefined> {
    const predicates = [...this.#requestLockPredicates.values()];
    const isRequestLocked = (track: TrackWithRequester<BoomBoxTrack, R>) => predicates.some(pred => pred(track));

    let i = 0;
    while (i < this.#requests.length) {
      const track = this.#requests.at(i);

      if (!track) {
        this.#requests.delete(i);
        continue;
      }

      if (isRequestLocked(track)) {
        i++;
        continue;
      }

      this.#requests.delete(i);

      if (await this.#isTrackLoadable(track.path)) {
        return track;
      }

      this.#logger.warn({ path: track.path }, 'Skipping request, track is unloadable');
    }

    return undefined;
  }

  get allRequests() {
    return this.#requests;
  }

  getRequestsOf(requester: R) {
    const matchRequester = matches(requester);
    return this.#requests.filter(r => r.requestedBy.some(matchRequester));
  }

  unrequest(requestIds: number[], requester?: R) {
    const removed = (() => {
      if (requester) {
        const matchRequester = matches(requester);

        const requests = this.#requests.filter(r => r.requestedBy.some(matchRequester));

        for (const r of requests) {
          const counter = r.requestedBy.length;
          r.requestedBy = reject(r.requestedBy, matchRequester);

          if (r.priority !== undefined) {
            const reduction = counter - r.requestedBy.length;
            r.priority -= reduction;
          }
        }

        this.#requests.removeBy(r => r.requestedBy.length === 0);

        return requests;
      }

      const all = new Set(requestIds);
      return this.#requests.removeBy(r => all.has(r.rid));
    })();

    return {
      removed,
      invalid: without(requestIds, ...removed.map(r => r.rid))
    }
  }

  #enqueue: EnqueueListener = async (done) => {
    if (this.queue.length > 0) {
      done(true);
    }

    try {
      const addToQueue = (track: BoomBoxTrack) => {
        if (process.env.DEBUG) {
          this.#logger.debug(
            {
              p: track.path,
              co: track.collection.id,
              cr: track.sequencing?.crate
                ? {
                  id: track.sequencing.crate.id,
                  sources: track.sequencing.crate.sources?.map(s => s.id)
                }
                : undefined,
              o: track.sequencing?.playOrder,
              l: track.sequencing?.latch
                ? track.sequencing.latch.order
                : undefined
            },
            'Track queued',
          );
        } else {
          this.#logger.info('Track queued: collection: %s, path: %s', track.collection.id, track.path);
        }

        this.queue.add(track);
        this.emit('trackQueued', track);
        done(true);
      }

      const requestedTrack = await this.#fetchRequestTrack();

      /**
       * The number of track being inserted during the request processing
       */
      const numRequestTrackInserted = (requestedTrack
        ? await this.#onInsertRequestTrack?.(requestedTrack)
        : undefined
      ) ?? 0;

      const nextTrack = requestedTrack ?? await this.#sequencer.nextTrack();

      if (!nextTrack) {
        done(false);
        return;
      }

      const currentTrack = this.#currentTrackPlay?.track;
      const currentCollection = currentTrack?.collection;
      const currentProfile = this.#currentCrate?.profile as (P | undefined);

      const nextIsLatch = nextTrack.sequencing?.latch !== undefined;
      const nextCollection = nextTrack.collection;
      const nextCrate = nextTrack.sequencing?.crate;
      const nextProfile = nextCrate?.profile;

      const collectionChange = currentCollection?.id !== nextCollection.id;

      if (nextProfile && nextProfile !== currentProfile) {
        if (!isRequestTrack(currentTrack) && !isRequestTrack(nextTrack)) {
          this.emit('profileChange', currentProfile, nextProfile as P)
          this.#logger.debug('Play profile changed to: %s', nextProfile.id);
        }
      }

      // Always trigger collection change event
      if (collectionChange && nextCollection) {
        const fromReqeustTrack = isRequestTrack(currentTrack);
        const toReqeustTrack = isRequestTrack(nextTrack);

        // Prevent any sweepers if the queue was manipulated by the request processing
        // Also should prevent sweepers when playing consecutive request tracks
        const preventSweepers = (numRequestTrackInserted >= 1) || (fromReqeustTrack && toReqeustTrack);

        this.emit('collectionChange', {
          oldCollection: currentCollection,
          newCollection: nextCollection,
          fromReqeustTrack,
          toReqeustTrack,
          preventSweepers
        });
      }

      // Latching shouldn't cause crate change, to preserve sequencing order
      if (!nextIsLatch && this.#currentCrate !== nextCrate) {
        if (nextCrate) {
          this.emit('crateChange', this.#currentCrate, nextCrate);
        }

        this.#currentCrate = nextCrate;
      }

      addToQueue(nextTrack);
      return;
    }
    catch (e) {
      this.#logger.error(e, 'Error enqueuing');
      this.emit('error', e as Error);
    }

    done(false);
  }

  #deckLoaded: DeckListener<BoomBoxTrack> = async (deckIndex, trackPlay) => {
    this.#decks[deckIndex] = {
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
        extra.maybeCoverAndLyrics = MetadataHelper.for(`boombox-${this.id}`, helper => helper.coverAndLyrics(trackPlay.track.path));
      }

      if (isRequestTrack(track) && !track.original.extra?.maybeCoverAndLyrics) {
        track.original.extra = {
          ...extra,
          kind: TrackKind.Normal
        };
      }
    }
    this.#logger.info('Deck %d> Loaded: %s', deckIndex, trackPlay.track.path);
    this.emit('deckLoaded', deckIndex, trackPlay);
  }

  #deckUnloaded: DeckListener<BoomBoxTrack> = async (deckIndex, trackPlay) => {
    this.#decks[deckIndex] = {
      trackPlay: undefined,
      playing: false,
      active: false
    }

    const trackIsActuallyUnloaded = this.#decks.find((deck) => deck.trackPlay?.track.id === trackPlay.track.id) === undefined;

    if (!trackIsActuallyUnloaded) {
      this.#logger.warn('Deck unloaded, but the track is being loaded by some other decks');
    }

    // clean up memory holding the cover, lyrics and extra
    if (trackIsActuallyUnloaded) {
      trackPlay.track.sequencing = undefined;

      if (trackPlay.track.extra) {
        trackPlay.track.extra.maybeCoverAndLyrics = undefined;
        trackPlay.track.extra.maybeAudioProperties = undefined;
      }

      if (isRequestTrack(trackPlay.track) && trackPlay.track.original.extra?.maybeCoverAndLyrics) {
        trackPlay.track.original.extra.maybeCoverAndLyrics = undefined;
      }
    }

    this.#logger.info('Deck %d> Unloaded', deckIndex);
    this.emit('deckUnloaded', deckIndex, trackPlay);
  }

  #deckStarted: DeckListener<BoomBoxTrack> = (deckIndex, trackPlay) => {
    this.#decks[deckIndex].playing = true;

    this.#logger.info('Deck %d> Started', deckIndex);

    const kind = trackPlay.track.extra?.kind;

    this.#inTransition = kind === TrackKind.Insertion;

    this.emit('deckStarted', deckIndex, trackPlay);

    if (kind === TrackKind.Insertion) {
      return;
    }

    if (kind === undefined) {
      return;
    }

    if (this.#currentTrackPlay?.uuid === trackPlay.uuid) {
      return;
    }

    const lastTrack = this.#currentTrackPlay;
    this.#currentTrackPlay = trackPlay;

    this.emit('trackStarted', deckIndex, trackPlay, lastTrack);

    const { artistBacklog } = this.options;

    if (artistBacklog) {
      const { extra } = trackPlay.track;
      if (extra) {
        this.artistHistory.push(getArtistStrings(extra));
        this.artistHistory = this.artistHistory.splice(-artistBacklog);
      }
    }
  }

  #deckFinished: DeckListener<BoomBoxTrack> = (deckIndex, trackPlay) => {
    this.#decks[deckIndex].playing = false;

    this.#logger.info('Deck %d> Finished', deckIndex);

    this.emit('deckFinished', deckIndex, trackPlay);

    const kind = trackPlay.track.extra?.kind;

    if (kind !== TrackKind.Insertion) {
      this.emit('trackFinished', deckIndex, trackPlay);
      return;
    }
  }

  #mainDeckChanged: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    this.#decks[deck].active = true;
    for (let i = 0; i < 3; i++) {
      if (i !== deck) {
        this.#decks[i].active = false;
      }
    }

    this.emit('deckActive', deck, trackPlay);

    const kind = trackPlay.track.extra?.kind;

    if (kind !== TrackKind.Insertion) {
      this.emit('trackActive', deck, trackPlay);
    }
  }

  get profile() {
    return this.#sequencer.profile as P;
  }

  get profiles() {
    return this.profileBook.all();
  }

  hasProfile(profile: P | string) {
    return isString(profile) ? this.profileBook.has(profile) : this.#profileBook.contains(profile);
  }

  addProfile(profile: P) {
    return this.#profileBook.add(profile);
  }

  removeProfile(profile: P | string) {
    return this.#profileBook.remove(profile);
  }

  getProfile(id: string): P | undefined {
    return this.#profileBook.get(id) as P;
  }

  changeProfile(id: string): P | undefined {
    const profile = this.getProfile(id);

    if (!profile) {
      return;
    }

    this.#sequencer.changeProfile(profile);
    return profile;
  }


  get crates() {
    return this.#sequencer.crates;
  }

  getCrateIndex() {
    return this.#sequencer.getCrateIndex();
  }

  setCrateIndex(newIndex: number) {
    this.#sequencer.setCrateIndex(newIndex, true);
  }

  /**
   *
   * @see {@link CrateSequencer.locateCrate}
   */
  locateCrate(collectionId: string) {
    return this.#sequencer.locateCrate(collectionId);
  }

  increasePlayCount() {
    return this.#sequencer.increasePlayCount();
  }

  latch(options?: LatchOptions<BoomBoxTrack>) {
    return this.#sequencer.latch(options);
  }

  removeLatch(session: number | string | LatchSession<BoomBoxTrack, BoomBoxTrackExtra>) {
    return this.#sequencer.removeLatch(session);
  }

  /**
   * Is the specified collection known by the sequencer for the current profile
   */
  isKnownCollection(collection: BoomBoxTrackCollection): boolean {
    return this.#sequencer.isKnownCollection(collection);
  }

  get currentSequenceCollection() {
    return this.#sequencer.currentCollection;
  }

  get currentSequenceCrate() {
    return this.#sequencer.currentCrate;
  }

  forcefullySelectCollection(collection: BoomBoxTrackCollection): boolean {
    return this.#sequencer.forcefullySelectCollection(collection);
  }

  get temporalCollection() {
    return this.#sequencer.temporalCollection;
  }

  get isLatchActive(): boolean {
    return this.#sequencer.getActiveLatch() !== undefined;
  }

  get allLatches(): ReadonlyArray<LatchSession<BoomBoxTrack, any>> {
    return this.#sequencer.allLatches;
  }
}

export type GetArtistsOptions = {
  excludes: {
    originalArtist?: boolean;
    albumArtist?: boolean;
  }
}

export type GetArtistsResult = Partial<Record<'artist' | 'originalArtist' | 'albumArtist', string>>;

export function getArtists(extra: BoomBoxTrackExtra, options?: GetArtistsOptions): GetArtistsResult | undefined {
  if (!extra?.tags) {
    return;
  }

  const { excludes } = options ?? {};

  const artist = extra.tags.artist;
  const originalArtist = !excludes?.originalArtist ? extra.tags.originalArtist : undefined;
  const albumArtist = !excludes?.albumArtist ? extra.tags.albumArtist : undefined;

  return mapValues({
    artist,
    originalArtist,
    albumArtist
  });
}

export function getArtistStrings(extra: BoomBoxTrackExtra, options?: GetArtistsOptions): string[] {
  const group = getArtists(extra, options);

  if (!group) {
    return [];
  }

  const { artist, originalArtist, albumArtist } = group;

  return chain([artist, originalArtist, albumArtist])
    .filter(isString)
    .flatMap(extractArtists)
    .value()
}

export function getTrackBanner(track: BoomBoxTrack) {
  const tags = track.extra?.tags;
  return (tags ? formatTags(tags) : undefined) ?? parsePath(track.path).name;
}

export function trackRecordOf(track: BoomBoxTrack): TrackRecord {
  const { extra } = track;

  return {
    trackId: track.id,
    title: extra?.tags?.title,
    artists: extra ? getArtistStrings(extra) : [],
    isrc: extra?.tags?.isrc
  }
}

export const extractCommentMetadata = (track: BoomBoxTrack, prefix: string) => (track.extra?.tags?.comments
  .filter(([key]) => key.startsWith(prefix))
  .map(([key, value]) => [key.substring(prefix.length), value])
  .reduce<Record<string, string>>((o, [key, value]) => {
    o[key] = value;
    return o;
  }, {})
  ?? {}) as Partial<Record<string, string>>;
