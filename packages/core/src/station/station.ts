import { TypedEmitter } from 'tiny-typed-emitter';
import { Join } from 'type-fest';
import { chain, sumBy } from 'lodash';

import {
  AudioLevels,
  DeckIndex,
  DeckPositions,
  Medley,
  Queue,
  RequestAudioOptions,
  TrackPlay,
  UpdateAudioStreamOptions
} from "@seamless-medley/medley";

import { createLogger, Logger } from "@seamless-medley/logging";

import { TrackCollectionBasicOptions, TrackIndex, WatchTrackCollection } from "../collections";
import { Crate, LatchOptions, LatchSession } from "../crate";
import { FindByCommentOptions, Library, LibrarySearchParams, LibraryOverallStats, MusicCollectionDescriptor, MusicDb, MusicLibrary, MusicLibraryEvents, MusicTrack, MusicTrackCollection } from "../library";
import {
  BoomBox,
  BoomBoxEvents,
  BoomBoxTrack,
  BoomBoxTrackCollection,
  BoomBoxTrackExtra,
  isRequestTrack,
  RequestTrackLockPredicate,
  SweeperInsertionRule,
  TrackKind,
  trackRecordOf,
  TrackWithRequester
} from "../playout";

import { SearchQueryField } from "../library/search";
import { CrateProfile } from "../crate/profile";

export type StationAudioLevels = AudioLevels & {
  reduction: number;
}

export enum PlayState {
  Idle = 'idle',
  Playing = 'playing',
  Paused = 'paused'
}

export type StationOptions = {
  id: string;

  name: string;

  description?: string;

  url?: string;
  iconURL?: string;

  useNullAudioDevice?: boolean;

  // BoomBox
  musicDb: MusicDb;

  /**
   * Number of maximum track history
   * @default 20
   */
  maxTrackHistory?: number;

  artistBacklog?: number | false;
  duplicationSimilarity?: number;
}

export enum AudienceType {
  Discord = 'discord',
  Web = 'web',
  Icy = 'icy',
  Streaming = 'streaming'
}

export type AudienceOfGroup<A extends AudienceType, G extends string[]> = `${A}$${Join<G, '/'>}`;

export type DiscordAudienceGroupId = AudienceOfGroup<AudienceType.Discord, [automatonId: string, guildId: string]>;

export type AudienceGroupId = DiscordAudienceGroupId | AudienceOfGroup<Exclude<AudienceType, AudienceType.Discord>, [string]>;

type RequesterT<T extends AudienceType, G> = {
  type: T;
  group: G;
  requesterId: string;
}

export type DiscordRequester = RequesterT<AudienceType.Discord, {
  automatonId: string;
  guildId: string;
}>

export type StreamingRequester = RequesterT<AudienceType.Icy | AudienceType.Streaming, string>;

export type WebRequester = RequesterT<AudienceType.Web, string>;

export type Requester = DiscordRequester | StreamingRequester | WebRequester;

export type StationTrack = MusicTrack<Station>;
export type StationTrackPlay = TrackPlay<StationTrack>;
export type StationTrackCollection = MusicTrackCollection<Station>;
export type StationRequestedTrack = TrackWithRequester<StationTrack, Requester> & {
  disallowSweepers?: boolean;
}

export type StationTrackIndex = TrackIndex<StationRequestedTrack>;

export type StationCrate = Crate<StationTrack>;

export type StationEvents = {
  trackQueued: (track: StationTrack) => void;
  deckLoaded: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  deckUnloaded: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  deckStarted: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  deckActive: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  deckFinished: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  trackStarted: (deck: DeckIndex, trackPlay: StationTrackPlay, lastTrackPlay?: StationTrackPlay) => void;
  trackActive: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  trackFinished: (deck: DeckIndex, trackPlay: StationTrackPlay) => void;
  trackSkipped: (trackPlay: StationTrackPlay) => void;
  collectionChange: (oldCollection: StationTrackCollection | undefined, newCollection: StationTrackCollection, transitingFromRequestTrack: boolean) => void;
  crateChange: (oldCrate: StationCrate | undefined, newCrate: StationCrate) => void;
  sequenceProfileChange: (oldProfile: StationProfile | undefined, newProfile: StationProfile) => void;
  profileChange: (oldProfile: StationProfile | undefined, newProfile: StationProfile) => void;
  latchCreated: (session: LatchSession<StationTrack, any>) => void;

  requestTrackAdded: (track: StationTrackIndex) => void;
  requestTracksRemoved: (tracks: StationRequestedTrack[]) => void;
  //
  collectionAdded: (collection: StationTrackCollection) => void;
  collectionRemoved: (collection: StationTrackCollection) => void;
  collectionUpdated: (collection: StationTrackCollection) => void;
  //
  libraryStats: (stats: LibraryOverallStats) => void;
  //
  audienceChanged: () => void;
}

type BoomBoxEventsForStation = BoomBoxEvents<StationProfile>;

export type StationSearchOptions = LibrarySearchParams & {
  noHistory?: boolean;
}

export class Station extends TypedEmitter<StationEvents> {
  readonly id: string;

  name: string;
  description?: string;

  url?: string;
  iconURL?: string;

  readonly queue: Queue<StationTrack>;
  readonly medley: Medley<StationTrack>;

  readonly #boombox: BoomBox<Requester, StationProfile>;

  readonly #musicDb: MusicDb;

  readonly #library: MusicLibrary<Station>;

  #profile = new StationProfile({ id: '$empty', name: '' });

  maxTrackHistory: number = 50;

  #audiences: Map<AudienceGroupId, Set<string>> = new Map();

  #audienceCount = 0;

  #logger: Logger;

  constructor(options: StationOptions) {
    super();

    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.url = options.url;
    this.iconURL = options.iconURL;

    this.maxTrackHistory = options.maxTrackHistory || 50;

    this.#logger = createLogger({ name: 'station', id: this.id });
    this.#logger.info('Creating station');

    const logMedley = process.env.DEBUG !== undefined;

    this.queue = new Queue();
    this.medley = new Medley(this.queue, { logging: logMedley });

    if (logMedley) {
      const medleyLogger = createLogger({ name: 'medley', id: this.id });
      const { trace, debug, info, warn, error, fatal } = medleyLogger;

      const logFns: (Function | undefined)[] = [
        process.env.MEDLEY_DEV !== undefined && !process.env.MEDLEY_DEV_NO_TRACE ? trace : undefined,
        debug,
        info,
        warn,
        error,
        fatal
      ];

      this.medley.on('log', (level, name, msg) => {
        logFns[level + 1]?.call(medleyLogger, { name: 'Engine', '$L': { type: this.id, id: name } }, msg);
      });
    }

    if (options.useNullAudioDevice ?? true) {
      const dev = this.getCurrentAudioDevice();

      if ((dev === undefined) || (dev.type !== 'Null')) {
        this.setAudioDevice({ type: 'Null', device: 'Null Device'});
      }
    }

    this.#musicDb = options.musicDb;

    this.#library = new MusicLibrary<Station>(
      this.id,
      this,
      this.#musicDb
    );

    this.#library.on('stats', this.#handleLibraryStats);

    // Create boombox
    const boombox = new BoomBox<Requester, StationProfile>({
      id: this.id,
      medley: this.medley,
      queue: this.queue,
      artistBacklog: options.artistBacklog !== false ? Math.max(options.artistBacklog ?? 0, this.maxTrackHistory) : false,
      duplicationSimilarity: options.duplicationSimilarity,
      onInsertRequestTrack: this.#handleRequestTrack
    });

    boombox.on('trackQueued', this.#handleTrackQueued);

    boombox.on('deckLoaded', this.#handleDeckLoaded);
    boombox.on('deckUnloaded', this.#handleDeckUnloaded);
    boombox.on('deckStarted', this.#handleDeckStarted);
    boombox.on('deckActive', this.#handleDeckActive);
    boombox.on('deckFinished', this.#handleDeckFinished);

    boombox.on('trackStarted', this.#handleTrackStarted);
    boombox.on('trackActive', this.#handleTrackActive);
    boombox.on('trackFinished', this.#handleTrackFinished);
    boombox.on('collectionChange', this.#handleCollectionChange);
    boombox.on('crateChange', this.#handleCrateChange);
    boombox.on('profileChange', this.#handleProfileChange);
    boombox.on('sequenceProfileChange', (o, n) => this.emit('sequenceProfileChange', o, n));
    boombox.on('latchCreated', session => this.emit('latchCreated', session));

    this.#musicDb.trackHistory
      .getAll(this.id)
      .then((records) => {
        boombox.artistHistory = records.map(r => r.artists);
      });

    this.#boombox = boombox;
  }

  get logger() {
    return this.#logger;
  }

  get musicDb() {
    return this.#musicDb;
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

  get audioLevels(): StationAudioLevels {
    const levels = this.medley.level;
    const reduction = this.medley.reduction;

    return {
      ...levels,
      reduction
    }
  }

  #handleLibraryStats: MusicLibraryEvents['stats'] = (stats) => {
    this.emit('libraryStats', stats);
  }

  #handleTrackQueued: BoomBoxEventsForStation['trackQueued'] = (track: StationTrack) => {
    this.emit('trackQueued', track);
  }

  #handleDeckLoaded: BoomBoxEventsForStation['deckLoaded'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckLoaded', deck, trackPlay);
  }

  #handleDeckUnloaded: BoomBoxEventsForStation['deckUnloaded'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckUnloaded', deck, trackPlay);
  }

  #handleDeckStarted: BoomBoxEventsForStation['deckStarted'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckStarted', deck, trackPlay);
  }

  #handleDeckActive: BoomBoxEventsForStation['deckActive'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckActive', deck, trackPlay);
    this.activeDeck = deck;
  }

  #handleDeckFinished: BoomBoxEventsForStation['deckFinished'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckFinished', deck, trackPlay);
  }

  #handleTrackStarted: BoomBoxEventsForStation['trackStarted'] = (deck, trackPlay: StationTrackPlay, lastTrackPlay?: StationTrackPlay) => {
    this.#starting = false;
    this.emit('trackStarted', deck, trackPlay, lastTrackPlay);

    this.#musicDb.trackHistory.add(this.id, {
      ...trackRecordOf(trackPlay.track),
      playedTime: new Date()
    }, this.maxTrackHistory);
  }

  #handleTrackActive: BoomBoxEventsForStation['trackActive'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('trackActive', deck, trackPlay);
  }

  #handleTrackFinished: BoomBoxEventsForStation['trackFinished'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('trackFinished', deck, trackPlay);
  }

  #handleCollectionChange: BoomBoxEventsForStation['collectionChange'] = (e) => {
    this.emit('collectionChange', e.oldCollection as StationTrackCollection | undefined, e.newCollection as StationTrackCollection, e.fromReqeustTrack && !e.toReqeustTrack);
  }

  #handleCrateChange: BoomBoxEventsForStation['crateChange'] = (oldCrate, newCrate) => {
    this.emit('crateChange', oldCrate, newCrate);
  }

  #handleProfileChange: BoomBoxEventsForStation['profileChange'] = (oldProfile, newProfile) => {
    this.emit('profileChange', oldProfile, newProfile);

    if (newProfile instanceof StationProfile) {
      const { intros } = this.#profile;

      if (!intros) {
        return;
      }

      const intro = intros.shift();
      if (!intro) {
        return;
      }

      if (intro.extra?.kind === undefined) {
        intro.extra = {
          ...intro.extra,
          kind: TrackKind.Insertion
        }
      }

      this.queue.add({
        ...intro,
        disableNextLeadIn: true
      });

      this.#logger.info('Inserting intro: %s', intro.path);

      intros.push(intro);
    }
  }

  #handleRequestTrack = async (track: StationRequestedTrack) => {
    const {
      requestSweepers,
      noRequestSweeperOnIdenticalCollection,
      followCollectionAfterRequestTrack
    } = this.#profile;

    const currentTrack =  this.#boombox.trackPlay?.track;
    const isSameCollection = currentTrack?.collection.id === track.collection.id;

    let inserted = 0;

    if (requestSweepers && !track.disallowSweepers) {
      const shouldSweep = noRequestSweeperOnIdenticalCollection
        ? !isSameCollection
        : true

      if (currentTrack?.extra?.kind !== TrackKind.Request && shouldSweep) {
        const count = requestSweepers.length;

        for (let i = 0; i < count; i++) {
          const sweeper = requestSweepers.shift();

          if (sweeper) {
            if (sweeper.extra?.kind === undefined) {
              sweeper.extra = {
                ...sweeper.extra,
                kind: TrackKind.Insertion
              }
            }

            this.queue.add({
              ...sweeper,
              disableNextLeadIn: true
            });

            inserted++;

            requestSweepers.push(sweeper);

            break;
          }
        }
      }
    }

    const oldCollection = this.currentSequenceCollection;

    if (followCollectionAfterRequestTrack && !track.collection.options.noFollowOnRequest && !this.isLatchActive) {
      this.#boombox.forcefullySelectCollection(track.collection);
    }

    if (oldCollection?.id !== track.collection.id) {
      this.emit(
        'collectionChange',
        oldCollection as StationTrackCollection | undefined,
        track.collection as StationTrackCollection,
        false
      );
    }

    if (isSameCollection && this.#boombox.isKnownCollection(track.collection)) {
      this.#boombox.increasePlayCount();
    }

    return inserted;
  }

  get playing() {
    return this.medley.playing;
  }

  get paused() {
    return this.medley.paused;
  }

  #playState: PlayState = PlayState.Idle;

  get playState(): PlayState {
    return this.#playState;
  }

  set playState(value) {
    this.#playState = value;
  }

  getDeckPositions(index: DeckIndex): DeckPositions {
    return this.#boombox.getDeckPositions(index);
  }

  getDeckInfo(index: DeckIndex) {
    return this.#boombox.getDeckInfo(index);
  }

  #activeDeck: DeckIndex | undefined;

  get activeDeck(): DeckIndex | undefined {
    return this.#activeDeck;
  }

  private set activeDeck(value: DeckIndex) {
    this.#activeDeck = value;
  }

  get trackPlay(): StationTrackPlay | undefined {
    return this.#boombox.trackPlay;
  }

  async trackHistory() {
    return this.#musicDb.trackHistory.getAll(this.id);
  }

  get isInTransition() {
    return this.#boombox.isInTransition;
  }

  skip() {
    if (this.isInTransition) {
      return false;
    }

    const ok = this.medley.fadeOut();
    if (ok) {
      this.playState = PlayState.Playing;
      this.#logger.info('Skipping track: %s', this.trackPlay?.track?.path);

      if (this.trackPlay) {
        this.emit('trackSkipped', this.trackPlay);
      }
    }

    return ok;
  }

  #starting = false;

  start(force?: boolean) {
    if (this.#starting && !force) {
      return;
    }

    if (force || !this.medley.playing || this.playState !== PlayState.Playing) {
      this.#starting = !this.medley.playing;
      this.medley.play(false);
      this.#logger.info('Playing started');

      this.playState = PlayState.Playing;
    }
  }

  pause(reason?: string) {
    if (!this.medley.paused) {
      this.medley.togglePause(false);
      this.#logger.info({ reason }, 'Playing paused');
    }

    this.playState = PlayState.Paused;

    this.#starting = false;
  }

  async requestAudioStream(options: RequestAudioOptions) {
    return this.medley.requestAudioStream(options);
  }

  deleteAudioStream(streamId: number) {
    this.medley.deleteAudioStream(streamId);
  }

  updateAudioStream(streamId: number, options: UpdateAudioStreamOptions) {
    this.medley.updateAudioStream(streamId, options);
  }

  //#region Collection
  hasCollection(id: string): boolean {
    return this.#library.has(id);
  }

  async addCollection(descriptor: MusicCollectionDescriptor) {
    const result = await this.#library.addCollection(descriptor);

    if (!result) {
      return;
    }

    this.emit('collectionAdded', result);
    return result;
  }

  removeCollection(id: string): boolean {
    if (!this.hasCollection(id)) {
      return false;
    }

    const isInUsed = this.crates.some(c => c.sources.some(col => col.id === id));
    if (isInUsed) {
      return false;
    }

    this.emit('collectionRemoved', this.getCollection(id)!);
    this.#library.remove(id);

    return true;
  }

  updateCollectionOptions(id: MusicCollectionDescriptor['id'], fn: (options: TrackCollectionBasicOptions) => TrackCollectionBasicOptions) {
    if (!this.hasCollection(id)) {
      return false;
    }

    const collection = this.#library.get(id)!;

    collection.options = fn(collection.options);

    this.emit('collectionUpdated', collection);
  }

  getCollection(id: string) {
    return this.#library.get(id);
  }

  get collections() {
    return this.#library.all();
  }

  /**
   * Get all collections currently known by the current profile
   */
  get knownCollections() {
    return this.collections.filter(collection => this.#boombox.isKnownCollection(collection));
  }

  forcefullySelectCollection(id: string): true | string {
    if (this.isLatchActive) {
      return 'A latch session is currently active';
    }

    const collection = this.getCollection(id);

    if (!collection) {
      return 'Unknown collection';
    }

    return this.#boombox.forcefullySelectCollection(collection)
      ? true
      : 'Invalid collection';
  }

  get currentSequenceCollection() {
    return this.#boombox.currentSequenceCollection;
  }

  get currentSequenceCrate() {
    return this.#boombox.currentSequenceCrate;
  }

  get temporalCollection() {
    return this.#boombox.temporalCollection;
  }

  //#endregion

  get profile() {
    return this.#boombox.profile;
  }

  get profiles() {
    return this.#boombox.profiles;
  }

  hasProfile(profile: StationProfile | string) {
    return this.#boombox.hasProfile(profile);
  }

  addProfile(profile: StationProfile) {
    return this.#boombox.addProfile(profile);
  }

  removeProfile(profile: StationProfile | string) {
    return this.#boombox.removeProfile(profile);
  }

  getProfile(id: string) {
    return this.#boombox.getProfile(id);
  }

  changeProfile(id: string) {
    const profile = this.#boombox.changeProfile(id);

    if (!profile) {
      return;
    }

    this.#profile = profile;
    this.#boombox.sweeperInsertionRules = profile.sweeperRules;

    if (this.#boombox.sweeperInsertionRules.length === 0 && id !== 'default') {
      this.#boombox.sweeperInsertionRules = this.getProfile('default')?.sweeperRules ?? [];
    }

    return profile;
  }

  get crates() {
    return this.#boombox.crates;
  }

  get currentCrate() {
    return this.#boombox.currentCrate;
  }

  findTrackById(id: StationTrack['id']) {
    return this.#library.findTrackById(id);
  }

  async findTracksByComment(key: string, value: string, options?: FindByCommentOptions) {
    return this.#library.findTracksByComment(key, value, options);
  }

  async search(searchOptions: StationSearchOptions) {
    const result = await this.#library.search(searchOptions);

    const { q, noHistory } = searchOptions;

    if (!noHistory) {
      this.#musicDb.searchHistory.add(this.id, { ...q, resultCount: result.length });
    }

    return result;
  }

  async autoSuggest(q: string, field?: SearchQueryField, narrowBy?: SearchQueryField, narrowTerm?: string) {
    if (!q && !narrowBy) {
      const recent = await this.#musicDb.searchHistory.recentItems(this.id, field ?? 'query');

      if (recent.length) {
        return recent.map(([term]) => term);
      }
    }

    return this.#library.autoSuggest(q, field, narrowBy, narrowTerm);
  }

  async request(trackId: StationTrack['id'], requestedBy: Requester, noSweep?: boolean): Promise<StationTrackIndex | string> {
    const track = this.findTrackById(trackId);

    if (!track) {
      return 'Unknown track';
    }

    const requestedTrack = await this.#boombox.request(track, requestedBy) as StationTrackIndex;

    if (!requestedTrack) {
      return 'Track could not be loaded';
    }

    requestedTrack.track.disallowSweepers = noSweep;

    this.emit('requestTrackAdded', requestedTrack);

    this.#logger.info(
      {
        path: requestedTrack.track.path,
        by: requestedTrack.track.requestedBy
      },
      'Added a requested track'
    );

    this.updatePlayback();

    return requestedTrack;
  }

  get requestsCount() {
    return this.#boombox.requestsCount;
  }

  get allRequests() {
    return this.#boombox.allRequests;
  }

  peekRequests(centerIndex: number, count: number, filterFn?: (track: StationRequestedTrack) => boolean) {
    return this.#boombox.allRequests.peek(centerIndex, count, filterFn ?? (() => true));
  }

  lockRequests(by: RequestTrackLockPredicate<Requester>) {
    this.#boombox.lockRequests(by);
  }

  unlockRequests(by: RequestTrackLockPredicate<Requester>): boolean {
    return this.#boombox.unlockRequests(by);
  }

  sortRequests(scoped: boolean = false) {
    this.#boombox.sortRequests(
      scoped
        ? t => t.requestedBy.map(a => a.type + ':' + (a.type === AudienceType.Discord ? a.group.guildId : a.group))
        : undefined
    );
  }

  getRequestsOf(requester: Requester) {
    return this.#boombox.getRequestsOf(requester);
  }

  unrequest(requestIds: number[], requester?: Requester) {
    const result = this.#boombox.unrequest(requestIds, requester);

    if (result.removed.length > 0) {
      this.emit('requestTracksRemoved', result.removed);
    }

    return result;
  }

  getTracksFromQueue() {
    return this.queue.toArray();
  }

  getTracksFromDecks() {
    return chain([0, 1, 2])
      .map(i => this.getDeckInfo(i))
      .map(info => !info.active && info.trackPlay?.track)
      .filter(track => !!track)
      .value();
  }

  getFetchedRequests() {
    const tracksFromQueue = this.getTracksFromQueue();
    const tracksFromDecks = this.getTracksFromDecks();

    return [...tracksFromQueue, ...tracksFromDecks]
      .filter((t): t is TrackWithRequester<BoomBoxTrack, Requester> => !!t && isRequestTrack(t))
  }

  addAudience(groupId: AudienceGroupId, audienceId: string) {
    if (!this.#audiences.has(groupId)) {
      this.#audiences.set(groupId, new Set());
    }

    const aud = this.#audiences.get(groupId);
    if (aud) {
      if (!aud.has(audienceId)) {
        aud.add(audienceId);
        this.audienceCount += 1;
      }
    }

    return this.playIfHasAudiences();
  }

  removeAudience(groupId: AudienceGroupId, audienceId: string) {
    const aud = this.getAudiences(groupId);

    if (aud) {
      if (aud.delete(audienceId)) {
        this.audienceCount -= 1;
      }
    }

    return this.pauseIfNoAudiences('an audience removed');
  }

  removeAudiencesForGroup(groupId: AudienceGroupId) {
    if (this.#audiences.delete(groupId)) {
      this.audienceCount = this.countAudiences();
    }
    return this.pauseIfNoAudiences('audiences group removed');
  }

  updateAudiences(groupId: AudienceGroupId, audiences: string[], options?: { updatePlayback: boolean }) {
    this.#audiences.set(groupId, new Set(audiences));
    this.audienceCount = this.countAudiences();

    const { updatePlayback = true } = options ?? {};

    if (updatePlayback) {
      this.updatePlayback();
    }
  }

  updatePlayback() {
    if (this.hasAudiences) {
      this.start(true);
    } else {
      this.pause('Update playback, no audiences');
    }

    return !this.medley.paused;
  }

  playIfHasAudiences() {
    if (this.playState !== PlayState.Playing && this.hasAudiences) {
      this.start();
    }

    return !this.medley.paused;
  }

  pauseIfNoAudiences(reason?: string) {
    if (this.playState === PlayState.Playing && !this.hasAudiences) {
      this.pause('No audiences: ' + reason);
    }

    return this.medley.paused;
  }

  getAudiences(groupId: AudienceGroupId) {
    return this.#audiences.get(groupId);
  }

  countAudiences() {
    const groups = [...this.#audiences.values()];
    const result = sumBy(groups, g => g.size);
    return result;
  }

  get audienceCount() {
    return this.#audienceCount;
  }

  private set audienceCount(value) {
    if (this.#audienceCount === value) {
      return;
    }

    this.#audienceCount = value;
    this.emit('audienceChanged');
  }

  get hasAudiences() {
    return this.#audienceCount > 0;
  }

  get audienceGroups() {
    return Array.from(this.#audiences.keys());
  }

  latch(options?: LatchOptions<StationTrack>) {
    return this.#boombox.latch(options) as LatchSession<StationTrack, NonNullable<StationTrack['extra']>>;
  }

  removeLatch(session: number | string | LatchSession<BoomBoxTrack, BoomBoxTrackExtra>) {
    return this.#boombox.removeLatch(session);
  }

  get isLatchActive(): boolean {
    return this.#boombox.isLatchActive;
  }

  get allLatches(): ReadonlyArray<LatchSession<StationTrack, BoomBoxTrackExtra>> {
    return this.#boombox.allLatches;
  }

  async rescan(full?: boolean, scanningCb?: (collection: BoomBoxTrackCollection) => any) {
    const jingleCollections = this.profiles
      .flatMap(profile => ([
        profile.intros,
        profile.requestSweepers,
        ...profile.sweeperRules.map(r => r.collection),
      ]))
      .filter((c): c is WatchTrackCollection<BoomBoxTrack> => c instanceof WatchTrackCollection)

    for (const col of jingleCollections) {
      col.rescan(full);
    }

    return this.#library.rescan(full, scanningCb);
  }

  get libraryStats() {
    return this.#library.overallStats;
  }
}

export class StationRegistry<S extends Station> extends Library<S, {}, S['id']> {

}

export class StationProfile extends CrateProfile<StationTrack> {
  intros?: BoomBoxTrackCollection;

  sweeperRules: Array<SweeperInsertionRule> = [];

  requestSweepers?: BoomBoxTrackCollection;

  noRequestSweeperOnIdenticalCollection: boolean = true;

  followCollectionAfterRequestTrack: boolean = true;
}

export function makeAudienceGroupId(type: AudienceType.Discord, automatonId: string, guildId: string): DiscordAudienceGroupId;
export function makeAudienceGroupId(type: Exclude<AudienceType, AudienceType.Discord>, groupId: string): AudienceGroupId;
export function makeAudienceGroupId(type: AudienceType, ...groupIds: string[]): AudienceGroupId {
  return `${type}$${groupIds.join('/')}` as AudienceGroupId;
}

export const extractAudienceGroupFromId = (agid: AudienceGroupId) => {
  const [type, groupId] = agid.split('$', 2);

  return {
    type: type as AudienceType,
    groupId: groupId.split('/')
  }
}

export function extractRequesterGroup({ group }: Requester): Requester['group'] { return group; }

export function makeRequester(type: AudienceType.Discord, group: DiscordRequester['group'], snowflake: string): DiscordRequester;
export function makeRequester(type: AudienceType, group: any, requesterId: string): Requester {
  return {
    type,
    group,
    requesterId
  }
}

type TrackSortFn = (track: StationTrack) => number;

export type StationTrackSorters = [
  nonAuxiliary: TrackSortFn,
  followable: TrackSortFn,
  withCurrentCollection: TrackSortFn,
  withCurrentCrate: TrackSortFn
];

export function getStationTrackSorters(station: Station): StationTrackSorters {
  const withCurrentCollection = (track: StationTrack) => (
    station.currentSequenceCollection?.id && track.collection.id === station.currentSequenceCollection?.id
      ? 0
      : 1
  );

  const withCurrentCrate = (track: StationTrack) => (
    (station.currentSequenceCrate?.sources ?? []).find(c => c.id === track.collection.id)
      ? 0
      : 1
  );

  const followable = (track: StationTrack) => (!track.collection.options?.noFollowOnRequest
    ? 0
    : 1
  );

  const nonAuxiliary = (track: StationTrack) => (!track.collection.options?.auxiliary
    ? 0
    : 1
  );

  return [
    nonAuxiliary,
    followable,
    withCurrentCollection,
    withCurrentCrate,
  ];
}
