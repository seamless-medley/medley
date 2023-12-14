import { TypedEmitter } from 'tiny-typed-emitter';

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

import { TrackCollectionBasicOptions, TrackIndex } from "./collections";
import { Crate, LatchOptions, LatchSession } from "./crate";
import { Library, MusicCollectionDescriptor, MusicDb, MusicLibrary, MusicTrack, MusicTrackCollection } from "./library";
import { createLogger, Logger } from "@seamless-medley/logging";
import {
  BoomBox,
  BoomBoxEvents,
  BoomBoxTrack,
  BoomBoxTrackCollection,
  BoomBoxTrackExtra,
  RequestTrackLockPredicate,
  SweeperInsertionRule,
  TrackKind,
  trackRecordOf,
  TrackWithRequester
} from "./playout";
import { MetadataHelper } from "./metadata";
import { SearchQuery, SearchQueryField } from "./library/search";
import { CrateProfile } from "./crate/profile";

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
  Icy = 'icy',
  Web = 'web'
}

export type DiscordAudienceGroupId = `${AudienceType.Discord}${string}/${string}`;

export type AudienceGroupId = DiscordAudienceGroupId | `${Exclude<AudienceType, AudienceType.Discord>}$${string}`;

type AudienceT<T extends AudienceType, G = string> = {
  type: T;
  group: G;
  id: string;
}

export type DiscordAudience = Omit<AudienceT<AudienceType.Discord, never>, 'group'> & {
  group: {
    automatonId: string;
    guildId: string;
  }
}

export type IcyAudience = AudienceT<AudienceType.Icy>;

export type WebAudience = AudienceT<AudienceType.Web>;

export type Audience = DiscordAudience | IcyAudience | WebAudience;

export type StationTrack = MusicTrack<Station>;
export type StationTrackPlay = TrackPlay<StationTrack>;
export type StationTrackCollection = MusicTrackCollection<Station>;
export type StationRequestedTrack = TrackWithRequester<StationTrack, Audience> & {
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
}

type BoomBoxEventsForStation = BoomBoxEvents<StationProfile>;

export class Station extends TypedEmitter<StationEvents> {
  readonly id: string;

  name: string;
  description?: string;

  url?: string;
  iconURL?: string;

  readonly queue: Queue<StationTrack>;
  readonly medley: Medley<StationTrack>;

  readonly #boombox: BoomBox<Audience, StationProfile>;

  readonly #musicDb: MusicDb;

  readonly #library: MusicLibrary<Station>;

  #profile = new StationProfile({ id: '$empty', name: '' });

  maxTrackHistory: number = 50;

  #audiences: Map<AudienceGroupId, Set<string>> = new Map();

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

    // Create boombox
    const boombox = new BoomBox<Audience, StationProfile>({
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

  #handleCollectionChange: BoomBoxEventsForStation['collectionChange'] = (oldCollection, newCollection, transitingFromRequestTrack) => {
    this.emit('collectionChange', oldCollection as StationTrackCollection | undefined, newCollection as StationTrackCollection, transitingFromRequestTrack);
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
      followCrateAfterRequestTrack
    } = this.#profile;

    const currentTrack =  this.#boombox.trackPlay?.track;
    const isSameCollection = currentTrack?.collection.id === track.collection.id;

    if (requestSweepers && !track.disallowSweepers) {
      const shouldSweep = noRequestSweeperOnIdenticalCollection
        ? !isSameCollection
        : true

      if (currentTrack?.extra?.kind !== TrackKind.Request && shouldSweep) {
        const count = requestSweepers.length;

        for (let i = 0; i < count; i++) {
          const sweeper = requestSweepers.shift();

          if (sweeper && await MetadataHelper.isTrackLoadable(sweeper.path)) {
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

            requestSweepers.push(sweeper);

            break;
          }
        }
      }
    }

    if (followCrateAfterRequestTrack && !track.collection.options.noFollowOnRequest) {
      if (!this.isLatchActive) {
        // const located = this.#boombox.locateCrate(track.collection.id);
        // const oldCrateIndex = this.#boombox.getCrateIndex();

        // if (located !== undefined && located !== oldCrateIndex) {
        //   this.#logger.debug(
        //     {
        //       old: this.#boombox.crates[oldCrateIndex].id,
        //       new: this.#boombox.crates[located].id
        //     },
        //     'Follow crate after a request track'
        //   );

        //   this.#boombox.setCrateIndex(located);
        // }

        const oldCollection = this.currentSequenceCollection;
        this.#boombox.forcefullySelectCollection(track.collection);

        if (oldCollection?.id !== track.collection.id) {
          this.emit(
            'collectionChange',
            oldCollection as StationTrackCollection | undefined,
            track.collection as StationTrackCollection,
            false
          );
        }
      }
    }

    if (isSameCollection && this.#boombox.isKnownCollection(track.collection)) {
      this.#boombox.increasePlayCount();
    }
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
      this.#logger.info('Skipping track: %s', this.trackPlay?.track?.path);
    }

    return ok;
  }

  #starting = false;

  start() {
    if (this.#starting) {
      return;
    }

    if (this.playState !== PlayState.Playing) {
      this.#starting = true;
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

  async search(q: SearchQuery, limit?: number) {
    const result = await this.#library.search(q, limit);

    this.#musicDb.searchHistory.add(this.id, { ...q, resultCount: result.length });

    return result as StationTrack[];
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

  async request(trackId: StationTrack['id'], requestedBy: Audience, noSweep?: boolean): Promise<StationTrackIndex | string> {
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

    return requestedTrack;
  }

  get requestsCount() {
    return this.#boombox.requestsCount;
  }

  get allRequests() {
    return this.#boombox.allRequests;
  }

  peekRequests(bottomIndex: number, n: number, filterFn?: (track: StationRequestedTrack) => boolean) {
    return this.#boombox.allRequests.peek(bottomIndex, n, filterFn ?? (() => true));
  }

  lockRequests(by: RequestTrackLockPredicate<Audience>) {
    this.#boombox.lockRequests(by);
  }

  unlockRequests(by: RequestTrackLockPredicate<Audience>): boolean {
    return this.#boombox.unlockRequests(by);
  }

  sortRequests(scoped: boolean = false) {
    this.#boombox.sortRequests(
      scoped
        ? t => t.requestedBy.map(a => a.type + ':' + (a.type === AudienceType.Discord ? a.group.guildId : a.group))
        : undefined
    );
  }

  getRequestsOf(requester: Audience) {
    return this.#boombox.getRequestsOf(requester);
  }

  unrequest(requestIds: number[]) {
    const result = this.#boombox.unrequest(requestIds);

    if (result.removed.length > 0) {
      this.emit('requestTracksRemoved', result.removed);
    }

    return result;
  }

  addAudience(groupId: AudienceGroupId, audienceId: string) {
    if (!this.#audiences.has(groupId)) {
      this.#audiences.set(groupId, new Set());
    }

    this.#audiences.get(groupId)!.add(audienceId);
    return this.playIfHasAudiences();
  }

  removeAudience(groupId: AudienceGroupId, audienceId: string) {
    this.getAudiences(groupId)?.delete(audienceId);
    return this.pauseIfNoAudiences('an audience removed');
  }

  removeAudiencesForGroup(groupId: AudienceGroupId) {
    this.#audiences.delete(groupId);
    return this.pauseIfNoAudiences('audiences group removed');
  }

  updateAudiences(groupId: AudienceGroupId, audiences: string[]) {
    this.#audiences.set(groupId, new Set(audiences));
    this.updatePlayback();
  }

  updatePlayback() {
    if (this.hasAudiences) {
      this.start();
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

  get totalAudiences() {
    const audiences = new Set<string>();

    for (const aud of this.#audiences.values()) {
      for (const id of aud.keys()) {
        audiences.add(id);
      }
    }

    return audiences.size;
  }

  get hasAudiences() {
    for (const aud of this.#audiences.values()) {
      if (aud.size > 0) {
        return true;
      }
    }

    return false;
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

  /** @deprecated */
  isCollectionLatchable(collection: StationTrackCollection): boolean {
    return !collection.latchDisabled && this.#boombox.isKnownCollection(collection);
  }

  get isLatchActive(): boolean {
    return this.#boombox.isLatchActive;
  }

  get allLatches(): ReadonlyArray<LatchSession<StationTrack, BoomBoxTrackExtra>> {
    return this.#boombox.allLatches;
  }
}

export class StationRegistry<S extends Station> extends Library<S, S['id']> {

}

export class StationProfile extends CrateProfile<StationTrack> {
  intros?: BoomBoxTrackCollection;

  sweeperRules: Array<SweeperInsertionRule> = [];

  requestSweepers?: BoomBoxTrackCollection;

  noRequestSweeperOnIdenticalCollection: boolean = true;

  /**
   * @deprecated will be changed to `followCollectionAfterRequestTrack`
   * since the sequencer is now cpable of selection certain collection in a crate on demand
   * */
  followCrateAfterRequestTrack: boolean = true;
}

export function makeAudienceGroupId(type: AudienceType.Discord, automatonId: string, guildId: string): DiscordAudienceGroupId;
export function makeAudienceGroupId(type: AudienceType.Icy | AudienceType.Web, groupId: string): AudienceGroupId;
export function makeAudienceGroupId(type: AudienceType, ...groupIds: string[]): AudienceGroupId {
  return `${type}$${groupIds.join('/')}` as AudienceGroupId;
}

export const extractAudienceGroupFromId = (id: AudienceGroupId) => {
  const [type, groupId] = id.split('$', 2);

  if (type === AudienceType.Discord) {
    return {
      type: type as AudienceType.Discord,
      groupId: groupId as DiscordAudienceGroupId
    }
  }

  return {
    type: type as (AudienceType.Icy | AudienceType.Web),
    groupId
  }
}

export function extractAudienceGroup({ group }: DiscordAudience): DiscordAudience['group'];
export function extractAudienceGroup({ group }: IcyAudience | WebAudience): string;
export function extractAudienceGroup({ group }: Audience): Audience['group'] { return group; }

export function makeAudience(type: AudienceType.Discord, group: DiscordAudience['group'], id: string): DiscordAudience
export function makeAudience(type: AudienceType, group: string |  DiscordAudience['group'], id: string): Audience {
  return {
    type,
    group: group as any,
    id
  }
}

