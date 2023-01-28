import { AudioLevels, DeckIndex, DeckPositions, Medley, Queue, RequestAudioOptions, TrackPlay } from "@seamless-medley/medley";
import { curry, isFunction, random, sample, shuffle, sortBy } from "lodash";
import { TypedEmitter } from 'tiny-typed-emitter';
import { TrackCollectionBasicOptions, TrackPeek } from "./collections";
import { Chanceable, Crate, CrateLimit, LatchOptions, LatchSession } from "./crate";
import { Library, MusicCollectionDescriptor, MusicDb, MusicLibrary, MusicTrack, MusicTrackCollection } from "./library";
import { createLogger, Logger, type ILogObj } from "./logging";
import {
  BoomBox,
  BoomBoxEvents,
  BoomBoxTrackCollection,
  BoomBoxTrackExtra,
  SweeperInsertionRule,
  TrackKind,
  trackRecordOf,
  TrackWithRequester
} from "./playout";
import { MetadataHelper } from "./metadata";
import { SearchQuery, SearchQueryField } from "./library/search";

export type StationAudioLevels = AudioLevels & {
  reduction: number;
}

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

  intros?: BoomBoxTrackCollection;

  requestSweepers?: BoomBoxTrackCollection;

  // BoomBox
  musicDb: MusicDb;

  /**
   * Number of maximum track history
   * @default 20
   */
  maxTrackHistory?: number;

  noDuplicatedArtist?: number | false;
  duplicationSimilarity?: number;

  /**
   * Whether to follow crate on a requested track
   * @default true
   */
  followCrateAfterRequestTrack?: boolean;

  /**
   * When enabled, a request sweeper will not be inserted
   * if the conseqcutive tracks are from the same collection
   *
   * @default true
   */
  noRequestSweeperOnIdenticalCollection?: boolean;
}

export enum AudienceType {
  Discord = 'discord',
  Icy = 'icy'
}

export type AudienceGroupId = `${AudienceType}$${string}`;


export type Audience = {
  group: AudienceGroupId;
  id: string;
}

export type StationTrack = MusicTrack<Station>;
export type StationTrackPlay = TrackPlay<StationTrack>;
export type StationTrackCollection = MusicTrackCollection<Station>;
export type StationRequestedTrack = TrackWithRequester<StationTrack, Audience>;
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
  collectionChange: (oldCollection: StationTrackCollection | undefined, newCollection: StationTrackCollection, trasitingFromRequestTrack: boolean) => void;
  crateChange: (oldCrate: StationCrate | undefined, newCrate: StationCrate) => void;

  requestTrackAdded: (track: TrackPeek<StationRequestedTrack>) => void;
  //
  collectionAdded: (collection: StationTrackCollection) => void;
  collectionRemoved: (collection: StationTrackCollection) => void;
  collectionUpdated: (collection: StationTrackCollection) => void;
}

export class Station extends TypedEmitter<StationEvents> {
  readonly id: string;

  name: string;
  description?: string;

  readonly queue: Queue<StationTrack>;
  readonly medley: Medley<StationTrack>;

  private readonly boombox: BoomBox<Audience>;

  private readonly musicDb: MusicDb;

  private readonly library: MusicLibrary<Station>;

  intros?: StationOptions['intros'];
  requestSweepers?: StationOptions['requestSweepers'];

  followCrateAfterRequestTrack: boolean;

  noRequestSweeperOnIdenticalCollection: boolean;

  maxTrackHistory: number = 50;

  private audiences: Map<AudienceGroupId, Map<string, any>> = new Map();

  private logger: Logger<ILogObj>;

  constructor(options: Omit<StationOptions, 'musicCollections' | 'sequences' | 'sweeperRules'>) {
    super();

    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.intros = options.intros;
    this.requestSweepers = options.requestSweepers;
    this.followCrateAfterRequestTrack = options.followCrateAfterRequestTrack ?? true;
    this.maxTrackHistory = options.maxTrackHistory || 50;
    this.noRequestSweeperOnIdenticalCollection = options.noRequestSweeperOnIdenticalCollection ?? true;

    this.logger = createLogger({ name: `station/${this.id}`});
    this.logger.debug('Creating station');

    this.queue = new Queue();
    this.logger.debug('Queue created');
    this.medley = new Medley(this.queue);
    this.logger.debug('Medley engine created');

    if (options.useNullAudioDevice ?? true) {
      if (this.getCurrentAudioDevice().type !== 'Null') {
        this.setAudioDevice({ type: 'Null', device: 'Null Device'});
      }
    }

    this.musicDb = options.musicDb;

    this.library = new MusicLibrary<Station>(
      this.id,
      this,
      this.musicDb
    );

    // Create boombox
    const boombox = new BoomBox<Audience>({
      id: this.id,
      medley: this.medley,
      queue: this.queue,
      crates: [],
      noDuplicatedArtist: options.noDuplicatedArtist !== false ? Math.max(options.noDuplicatedArtist ?? 0, this.maxTrackHistory) : false,
      duplicationSimilarity: options.duplicationSimilarity,
      onInsertRequestTrack: this.handleRequestTrack
    });

    boombox.on('trackQueued', this.handleTrackQueued);

    boombox.on('deckLoaded', this.handleDeckLoaded);
    boombox.on('deckUnloaded', this.handleDeckUnloaded);
    boombox.on('deckStarted', this.handleDeckStarted);
    boombox.on('deckActive', this.handleDeckActive);
    boombox.on('deckFinished', this.handleDeckFinished);

    boombox.on('trackStarted', this.handleTrackStarted);
    boombox.on('trackActive', this.handleTrackActive);
    boombox.on('trackFinished', this.handleTrackFinished);
    boombox.on('collectionChange', this.handleCollectionChange);
    boombox.on('crateChange', this.handleCrateChange);

    this.musicDb.trackHistory
      .getAll(this.id)
      .then((records) => {
        boombox.artistHistory = records.map(r => r.artists);
      });

    this.boombox = boombox;
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

  private handleTrackQueued: BoomBoxEvents['trackQueued'] = (track: StationTrack) => {
    this.emit('trackQueued', track);
  }

  private handleDeckLoaded: BoomBoxEvents['deckLoaded'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckLoaded', deck, trackPlay);
  }

  private handleDeckUnloaded: BoomBoxEvents['deckUnloaded'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckUnloaded', deck, trackPlay);
  }

  private handleDeckStarted: BoomBoxEvents['deckStarted'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckStarted', deck, trackPlay);
  }

  private handleDeckActive: BoomBoxEvents['deckActive'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckActive', deck, trackPlay);
  }

  private handleDeckFinished: BoomBoxEvents['deckFinished'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('deckFinished', deck, trackPlay);
  }

  private handleTrackStarted: BoomBoxEvents['trackStarted'] = (deck, trackPlay: StationTrackPlay, lastTrackPlay?: StationTrackPlay) => {
    this._starting = false;
    this.emit('trackStarted', deck, trackPlay, lastTrackPlay);

    this.musicDb.trackHistory.add(this.id, {
      ...trackRecordOf(trackPlay.track),
      playedTime: new Date()
    }, this.maxTrackHistory);
  }

  private handleTrackActive: BoomBoxEvents['trackActive'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('trackActive', deck, trackPlay);
  }

  private handleTrackFinished: BoomBoxEvents['trackFinished'] = (deck, trackPlay: StationTrackPlay) => {
    this.emit('trackFinished', deck, trackPlay);
  }

  private handleCollectionChange: BoomBoxEvents['collectionChange'] = (oldCollection, newCollection, trasitingFromRequestTrack) => {
    this.emit('collectionChange', oldCollection as StationTrackCollection | undefined, newCollection as StationTrackCollection, trasitingFromRequestTrack);
  }

  private handleCrateChange: BoomBoxEvents['crateChange'] = (oldCrate, newCrate) => {
    this.emit('crateChange', oldCrate, newCrate);
  }

  private handleRequestTrack = async (track: StationRequestedTrack) => {
    const { requestSweepers } = this;

    const currentTrack =  this.boombox.trackPlay?.track;
    let isSameCollection = currentTrack?.collection.id === track.collection.id

    if (requestSweepers) {
      const shouldSweep = this.noRequestSweeperOnIdenticalCollection
        ? !isSameCollection
        : true

      if (currentTrack?.extra?.kind !== TrackKind.Request && shouldSweep) {
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
        }
      }
    }

    if (this.followCrateAfterRequestTrack && !track.collection.options.noFollowOnRequest) {
      if (!this.isLatchActive) {
        const indices = this.boombox.crates.map((crate, index) => ({ ids: new Set(crate.sources.map(s => s.id)), index }));

        const crateIndex = this.boombox.getCrateIndex();

        const a = indices.slice(0, crateIndex);
        const b = indices.slice(crateIndex);

        const located = [...b, ...a].find(({ ids }) => ids.has(track.collection.id));

        if (located) {
          isSameCollection = true;
          this.boombox.setCrateIndex(located.index);
        }
      }
    }

    if (isSameCollection && this.boombox.isKnownCollection(track.collection)) {
      this.boombox.increasePlayCount();
    }
  }

  get playing() {
    return this.medley.playing;
  }

  get paused() {
    return this.medley.paused;
  }

  private _playState: PlayState = PlayState.Idle;

  get playState(): PlayState {
    return this._playState;
  }

  private set playState(value) {
    this._playState = value;
  }

  getDeckPositions(index: DeckIndex): DeckPositions {
    return this.boombox.getDeckPositions(index);
  }

  getDeckInfo(index: DeckIndex) {
    return this.boombox.getDeckInfo(index);
  }

  get trackPlay() {
    return this.boombox.trackPlay as StationTrackPlay;
  }

  async trackHistory() {
    return this.musicDb.trackHistory.getAll(this.id);
  }

  get isInTransition() {
    return this.boombox.isInTransition;
  }

  skip() {
    return this.isInTransition ? false : this.medley.fadeOut();
  }

  private _starting = false;

  start() {
    if (this._starting) {
      return;
    }

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

          this.queue.add({
            ...intro,
            disableNextLeadIn: true
          });
          this.intros.push(intro);
        }
      }
    }

    if (this.playState !== PlayState.Playing) {
      this._starting = true;
      this.medley.play(false);
      this.logger.info('Playing started');

      this.playState = PlayState.Playing;
    }
  }

  pause() {
    if (!this.medley.paused) {
      this.medley.togglePause(false);
      this.logger.info('Playing paused');
    }

    this.playState = PlayState.Paused;

    this._starting = false;
  }

  async requestAudioStream(options: RequestAudioOptions) {
    return this.medley.requestAudioStream(options);
  }

  deleteAudioStream(streamId: number) {
    this.medley.deleteAudioStream(streamId);
  }

  //#region Collection

  async addCollection(descriptor: MusicCollectionDescriptor) {
    const result = await this.library.addCollection(descriptor);

    if (!result) {
      return;
    }

    this.emit('collectionAdded', result);
    return result;
  }

  removeCollection(id: string): boolean {
    if (!this.library.has(id)) {
      return false;
    }

    const isInUsed = this.crates.some(c => c.sources.some(col => col.id === id));
    if (isInUsed) {
      return false;
    }

    this.emit('collectionRemoved', this.getCollection(id)!);
    this.library.remove(id);

    return true;
  }

  updateCollectionOptions(id: MusicCollectionDescriptor['id'], options: TrackCollectionBasicOptions) {
    if (!this.library.has(id)) {
      return false;
    }

    const collection = this.library.get(id)!
    collection.options = { ...options };
    this.emit('collectionUpdated', collection);
  }

  getCollection(id: string) {
    return this.library.get(id);
  }

  get collections() {
    return this.library.all();
  }

  //#endregion

  updateSequence(sequences: SequenceConfig[]) {
    const crates = sequences
      .map(config => this.createCrate(config))
      .filter((c): c is Crate<StationTrack> => c !== undefined);

    this.addCrates(...crates);
  }

  private createCrate({ crateId, collections, chance, limit }: SequenceConfig) {
    const validCollections = collections.filter(col => this.library.has(col.id));

    if (validCollections.length === 0) {
      return;
    }

    const existing = this.boombox.crates.find(c => c.id === crateId);

    return new Crate({
      id: crateId,
      sources: validCollections.map(({ id, weight = 1 }) => ({ collection: this.library.get(id)!, weight })),
      chance: createChanceable(chance),
      limit: crateLimitFromSequenceLimit(limit),
      max: existing?.max
    });
  }

  addCrates(...crates: Crate<StationTrack>[]) {
    this.boombox.addCrates(...crates);
  }

  removeCrates(...cratesOrIds: Array<Crate<StationTrack>['id'] | Crate<StationTrack>>) {
    this.boombox.removeCrates(...cratesOrIds);
  }

  moveCrates(newPosition: number, ...cratesOrIds: Array<Crate<StationTrack>['id'] | Crate<StationTrack>>) {
    this.boombox.moveCrates(newPosition, ...cratesOrIds);
  }

  get crates() {
    return this.boombox.crates;
  }

  set sweeperInsertionRules(rules: SweeperInsertionRule[]) {
    this.boombox.sweeperInsertionRules = rules;
  }

  findTrackById(id: StationTrack['id']) {
    return this.library.findTrackById(id);
  }

  async search(q: SearchQuery, limit?: number) {
    const result = await this.library.search(q, limit);

    this.musicDb.searchHistory.add(this.id, { ...q, resultCount: result.length });

    return result as StationTrack[];
  }

  async autoSuggest(q: string, field?: SearchQueryField, narrowBy?: SearchQueryField, narrowTerm?: string) {
    if (!q && !narrowBy) {
      const recent = await this.musicDb.searchHistory.recentItems(this.id, field ?? 'query');

      if (recent.length) {
        return recent.map(([term]) => term);
      }
    }

    return this.library.autoSuggest(q, field, narrowBy, narrowTerm);
  }

  async request(trackId: StationTrack['id'], requestedBy: Audience) {
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

  getCrateIndex() {
    return this.boombox.getCrateIndex();
  }

  setCrateIndex(newIndex: number) {
    this.boombox.setCrateIndex(newIndex);
  }

  addAudiences(groupId: AudienceGroupId, audienceId: string, data?: any) {
    if (!this.audiences.has(groupId)) {
      this.audiences.set(groupId, new Map());
    }

    this.audiences.get(groupId)!.set(audienceId, data);
    return this.playIfHasAudiences();
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
    this.updatePlayback();
  }

  updatePlayback() {
    if (this.hasAudiences) {
      this.start();
    } else {
      this.pause();
    }

    return !this.medley.paused;
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

  latch(options?: LatchOptions<StationTrack>) {
    return this.boombox.latch(options) as LatchSession<StationTrack, NonNullable<StationTrack['extra']>>;
  }

  isCollectionLatchable(collection: StationTrackCollection): boolean {
    return !collection.latchDisabled && this.boombox.isKnownCollection(collection);
  }

  get isLatchActive(): boolean {
    return this.boombox.isLatchActive;
  }

  get allLatches(): LatchSession<StationTrack, BoomBoxTrackExtra>[] {
    return this.boombox.allLatches;
  }
}

const randomChance = () => random() === 1;
const always = () => true;

function createChanceable(def: SequenceChance | undefined): Chanceable {
  if (def === 'random') {
    return { next: randomChance };
  }

  if (isFunction(def)) {
    return { next: def };
  }

  if (Array.isArray(def) && def.length > 1) {
    return chanceOf(def);
  }

  return {
    next: always,
    chances: () => [true]
  }
}

function chanceOf(n: [yes: number, no: number]): Chanceable {
  const [yes, no] = n;

  let all = shuffle(
    Array(yes).fill(true)
      .concat(Array(no).fill(false))
  );

  let count = 0;

  return {
    next: function chanceOf() {
      const v = all.shift();
      all.push(v);

      if (count >= all.length) {
        count = 0;
        all = shuffle(all);
      }

      return v ?? false;
    },
    chances: () => all
  }
}

function crateLimitFromSequenceLimit(limit: SequenceLimit): CrateLimit  {
  if (typeof limit === 'number') {
    return limit;
  }

  if (limit === 'all') {
    return limit;
  }

  const { by } = limit;

  if (by === 'upto') {
    const upto = () => random(1, limit.upto);
    return upto;
  }

  if (by === 'range') {
    const [min, max] = sortBy(limit.range);
    const range = () => random(min, max);
    return range;
  }

  if (by === 'sample' || by === 'one-of') {
    const oneOf = () => sample(limit.list) ?? 0;
    return oneOf;
  }

  return 0;
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
