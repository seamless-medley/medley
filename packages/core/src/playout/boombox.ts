import { parse as parsePath } from 'node:path';
import { castArray, chain, flatten, mapValues, matches, some, toLower, trim, uniq, without } from "lodash";
import { isString } from 'lodash/fp';
import { compareTwoStrings } from "string-similarity";
import { TypedEmitter } from "tiny-typed-emitter";
import { DeckListener, Medley, EnqueueListener, Queue, TrackPlay, Metadata, CoverAndLyrics, DeckIndex, DeckPositions, AudioProperties } from "@seamless-medley/medley";
import { Crate, CrateSequencer, LatchOptions, LatchSession, TrackValidator, TrackVerifier, TrackVerifierResult } from "../crate";
import { Track, TrackExtra } from "../track";
import { TrackCollection, TrackIndex, WatchTrackCollection } from "../collections";
import { SweeperInserter } from "./sweeper";
import { createLogger, Logger } from '@seamless-medley/logging';
import { MetadataHelper } from '../metadata';
import { MusicDb } from '../library/music_db';
import { CrateProfile, CrateProfileBook } from '../crate/profile';

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
export type BoomBoxTrackCollection = TrackCollection<BoomBoxTrack, any>;

export type Requester = any;

export type TrackWithRequester<T extends BoomBoxTrack, R extends Requester> = T & {
  rid: number;
  priority?: number;
  requestedBy: R[];
  firstRequestTime?: Date;
  original: T; // Store the original track as a RequestTrack is likely to be a clone
}

export type OnInsertRequestTrack<T extends BoomBoxTrack, R extends Requester> = (track: TrackWithRequester<T, R>) => Promise<void>;

export function isRequestTrack<T extends BoomBoxTrack, R extends Requester>(o: any): o is TrackWithRequester<T, R> {
  return !!o && !!o.requestedBy;
}

export type BoomBoxProfile = CrateProfile<BoomBoxTrack>;

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
  collectionChange: (oldCollection: BoomBoxTrackCollection | undefined, newCollection: BoomBoxTrackCollection, transitingFromRequestTrack: boolean) => void;

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

type BoomBoxOptions<T extends BoomBoxTrack, R extends Requester> = {
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
   * @default 0.8
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

export type RequestTrackLockPredicate<R extends Requester> = (t: TrackWithRequester<BoomBoxTrack, R>) => boolean;

export class BoomBox<R extends Requester, P extends BoomBoxProfile = CrateProfile<BoomBoxTrack>> extends TypedEmitter<BoomBoxEvents<P>> {
  readonly id: string;

  readonly #sequencer: CrateSequencer<BoomBoxTrack, BoomBoxTrackExtra, P>;
  readonly #sweeperInserter: SweeperInserter;

  options: Required<Pick<BoomBoxOptions<BoomBoxTrack, R>, 'artistBacklog' | 'duplicationSimilarity'>>;

  #decks = Array(3).fill(0).map<DeckInfo>(() => ({ playing: false, active: false })) as [DeckInfo, DeckInfo, DeckInfo];

  readonly medley: Medley<BoomBoxTrack>;
  readonly queue: Queue<BoomBoxTrack>;

  readonly musicDb?: MusicDb;

  readonly #onInsertRequestTrack?: OnInsertRequestTrack<BoomBoxTrack, R>;

  readonly #profileBook = new CrateProfileBook<BoomBoxProfile>();

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
      duplicationSimilarity: options.duplicationSimilarity || 0.8
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

  #isTrackLoadable: TrackValidator = async (path) => trackHelper.isTrackLoadable(path, 1000);

  #verifyTrack: TrackVerifier<BoomBoxTrackExtra> = async (track): Promise<TrackVerifierResult<BoomBoxTrackExtra>> => {
    try {
      let timestamp: number | undefined;
      let tags: Metadata;

      if (track.extra?.tags) {
        timestamp = track.extra.timestamp;
        tags = track.extra?.tags;
      } else {
        const fetched = await helper.fetchMetadata(track, this.musicDb, true);
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
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));

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
    const existing = this.#requests.fromId(track.id);

    if (existing) {
      existing.priority = (existing.priority || 0) + 1;

      if (requestedBy) {
        existing.requestedBy.push(requestedBy)
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
    const functions = [
      (t: TrackWithRequester<BoomBoxTrack, R>) => -(t.priority || 0),
      (t: TrackWithRequester<BoomBoxTrack, R>) => (t.firstRequestTime?.valueOf() || 0)
    ];

    if (!scopedBy) {
      this.#requests.sort(functions);
      return;
    }

    const scopes = uniq(this.#requests.all().flatMap(scopedBy));
    for (const [index, scope] of scopes.entries()) {
      this.#requests.sort(
        functions,
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

    for (let i = 0; i < this.#requests.length; i++) {
      const track = this.#requests.at(i);

      if (!track) {
        break;
      }

      if (predicates.some(pred => pred(track))) {
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

  unrequest(requestIds: number[]) {
    const all = new Set(requestIds);
    const removed = this.#requests.removeBy(r => all.has(r.rid));
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
      if (requestedTrack) {
        const loadable = await this.#isTrackLoadable(requestedTrack.path);

        if (!loadable) {
          this.#logger.warn({ path: requestedTrack.path }, 'The request is invalid');
          return;
        }

        await this.#onInsertRequestTrack?.(requestedTrack);
        addToQueue(requestedTrack);

        return;
      }

      const nextTrack = await this.#sequencer.nextTrack();

      if (!nextTrack) {
        done(false);
        return;
      }

      if (nextTrack.sequencing.latch === undefined) {
        const currentTrack = this.#currentTrackPlay?.track;
        const currentTrackCollection = currentTrack?.collection;

        const nextCollection = nextTrack.collection;
        const collectionChange = currentTrackCollection?.id !== nextCollection.id;

        if (this.#currentCrate?.profile !== nextTrack.sequencing.crate.profile) {
          this.emit('profileChange', this.#currentCrate?.profile as (P | undefined), nextTrack.sequencing.crate.profile as P)
          this.#logger.debug('Play profile changed to: %s', nextTrack.sequencing.crate.profile?.id);
        }

        if (collectionChange && nextCollection) {
          const transitingFromRequestTrack = isRequestTrack(currentTrack) && !isRequestTrack(nextTrack);
          this.emit('collectionChange', currentTrackCollection, nextCollection, transitingFromRequestTrack);
        }

        if (this.#currentCrate !== nextTrack.sequencing.crate) {
          if (nextTrack.sequencing.crate) {
            this.emit('crateChange', this.#currentCrate, nextTrack.sequencing.crate);
          }

          this.#currentCrate = nextTrack.sequencing.crate;
        }
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
        extra.maybeCoverAndLyrics = helper.coverAndLyrics(trackPlay.track.path);
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
    if (trackIsActuallyUnloaded && trackPlay.track?.extra) {
      trackPlay.track.extra.maybeCoverAndLyrics = undefined;

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

  forcefullySelectCollection(collection: BoomBoxTrackCollection): boolean {
    return this.#sequencer.forcefullySelectCollection(collection);
  }

  get isLatchActive(): boolean {
    return this.#sequencer.getActiveLatch() !== undefined;
  }

  get allLatches(): ReadonlyArray<LatchSession<BoomBoxTrack, any>> {
    return this.#sequencer.allLatches;
  }
}

export const extractArtists = (artists: string) => uniq(artists.split(/[/;,]/)).map(trim);

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
  const info = formatSongBanner(tags?.artist ? extractArtists(tags.artist) : undefined, tags?.title);
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

const trackHelper = new MetadataHelper();
const helper = new MetadataHelper();
