import type { DeckIndex, DeckPositions } from "@seamless-medley/medley";
import { MixinEventEmitterOf, PureExpose } from "../../socket";
import type {
  DeckInfoWithPositions,
  Station as RemoteStation,
  StationProfile as RemoteProfile,
  Create as RemoteCrate,
  Track as RemoteTrack,
  Exposable,
  Notify,
  Remotable,
  RequestCollectionView,
  RequestTrackRecord
} from "@seamless-medley/remote";

import { Station, type StationEvents, type PlayState, StationProfile, Crate, StationTrack, TrackWithRequester, Requester } from "../../../core";
import { toRemoteDeckInfoWithPositions } from "./deck";
import { isFunction, zip } from "lodash";
import { BasedExposedCollectionView } from "./collection_view";
import { toRemoteTrack } from "./track";

export class ExposedStation extends MixinEventEmitterOf<RemoteStation>() implements Exposable<RemoteStation> {
  $Exposing: Station;
  $Kind = 'station';
  notify!: Notify<RemoteStation>;

  #currentCollectionId?: string;

  #currentProfileId: string;

  #profiles: RemoteProfile[] = [];

  #currentCrate?: string;

  #requestsCount: number = 0;

  constructor(station: Station) {
    super();
    this.$Exposing = station;

    this.#currentCollectionId = station.currentCollection?.id;
    this.#currentProfileId = station.profile.id;
    this.setProfiles(station.profiles);
    this.currentCrate = station.currentCrate?.id;
    this.#requestsCount = station.requestsCount;

    this.#station.on('deckLoaded', this.#onDeckLoaded);
    this.#station.on('deckUnloaded', this.#onDeckUnloaded);
    this.#station.on('deckStarted', this.#onDeckStarted);
    this.#station.on('deckActive', this.#onDeckActive);
    this.#station.on('collectionChange', this.#onCollectionChange);
    this.#station.on('crateIndexChange', this.#onCrateIndexChange);
    this.#station.on('sequenceProfileChange', this.#onSequenceProfileChange);
    this.#station.on('profileChange', this.#onProfileChange);
    this.#station.on('profileBookChange', this.#onProfileBookChange);
    this.#station.on('requestTrackAdded', this.#onRequestTrackAdded);
    this.#station.on('requestTracksRemoved', this.#onRequestTracksRemoved);
  }

  dispose() {
    this.#station.off('deckLoaded', this.#onDeckLoaded);
    this.#station.off('deckUnloaded', this.#onDeckUnloaded);
    this.#station.off('deckStarted', this.#onDeckStarted);
    this.#station.off('deckActive', this.#onDeckActive);
    this.#station.off('collectionChange', this.#onCollectionChange);
    this.#station.off('crateIndexChange', this.#onCrateIndexChange);
    this.#station.off('sequenceProfileChange', this.#onSequenceProfileChange);
    this.#station.off('profileChange', this.#onProfileChange);
    this.#station.off('profileBookChange', this.#onProfileBookChange);
    this.#station.off('requestTrackAdded', this.#onRequestTrackAdded);
    this.#station.off('requestTracksRemoved', this.#onRequestTracksRemoved);
  }

  get #station() {
    return this.$Exposing;
  }

  #onDeckLoaded: StationEvents['deckLoaded'] = async (deckIndex: number) => {
    const info = await this.getDeckInfo(deckIndex);
    this.emit('deckLoaded', deckIndex, info);
  }

  #onDeckUnloaded: StationEvents['deckUnloaded'] = async (deckIndex: number) => {
    this.emit('deckUnloaded', deckIndex);
  }

  #onDeckStarted: StationEvents['deckStarted'] = async (deckIndex: number) => {
    const { positions, trackPlay } = await this.getDeckInfo(deckIndex);
    this.emit('deckStarted', deckIndex, {
      ...positions,
      kind: trackPlay?.track.extra?.kind
    });
  }

  #onDeckActive: StationEvents['deckActive'] = async (deckIndex) => {
    const { positions, trackPlay } = await this.getDeckInfo(deckIndex);

    this.emit('deckActive', deckIndex, {
      ...positions,
      kind: trackPlay?.track.extra?.kind
    });
  }

  #onCollectionChange: StationEvents['collectionChange'] = (prevCollection, newCollection, fromRequestTrack) => {
    // setter
    this.currentCollection = newCollection.id;

    this.emit(
      'collectionChange',
      prevCollection?.id,
      newCollection.id,
      fromRequestTrack
    );
  }

  #onCrateIndexChange: StationEvents['crateIndexChange'] = (oldCrate, newCrate) => {
    this.currentCrate = newCrate.id;
    this.emit('crateChange', oldCrate?.id, newCrate.id);
  }

  #onSequenceProfileChange: StationEvents['sequenceProfileChange'] = (oldProfile, newProfile) => {
    if (this.currentProfile === newProfile.id) return;

    this.currentProfile = newProfile.id;
    this.emit('profileChange', oldProfile?.id, newProfile.id);
  }

  #onProfileChange: StationEvents['profileChange'] = (oldProfile, newProfile) => {
    this.currentProfile = newProfile.id;
    this.emit('profileChange', oldProfile?.id, newProfile.id);
  }

  #onProfileBookChange: StationEvents['profileBookChange'] = () => {
    this.setProfiles(this.#station.profiles);
    this.emit('profileBookChange');
  }

  #onRequestTrackAdded: StationEvents['requestTrackAdded'] = () => {
    this.requestsCount = this.#station.requestsCount;
    this.emit('requestTrackAdded');
  }

  #onRequestTracksRemoved: StationEvents['requestTracksRemoved'] = () => {
    this.requestsCount = this.#station.requestsCount;
    this.emit('requestTracksRemoved');
  }

  get audienceCount() {
    return this.#station.audienceCount;
  }

  get id() {
    return this.#station.id;
  }

  get name() {
    return this.#station.name;
  }

  set name(v) {
    this.#station.name = v;
  }

  get description() {
    return this.#station.description;
  }

  set description(v) {
    this.#station.description = v;
  }

  get url() {
    return this.#station.url;
  }

  set url(v) {
    this.#station.url = v;
  }

  get iconURL() {
    return this.#station.iconURL;
  }

  set iconURL(v) {
    this.#station.iconURL = v;
  }

  get playing() {
    return this.#station.playing;
  }

  get paused() {
    return this.#station.paused;
  }

  get playState(): PlayState {
    return this.#station.playState;
  }

  get activeDeck() {
    return this.#station.activeDeck;
  }

  get currentCollection() {
    return this.#currentCollectionId;
  }

  get requestsCount() {
    return this.#requestsCount;
  }

  @PureExpose
  private set requestsCount(value) {
    this.#requestsCount = value;
  }

  @PureExpose
  private set currentCollection(value) {
    this.#currentCollectionId = value;
  }

  get currentProfile() {
    return this.#currentProfileId;
  }

  @PureExpose
  private set currentProfile(value) {
    this.#currentProfileId = value;
  }

  async start() {
    this.#station.start();
  }

  async pause() {
    this.#station.pause();
  }

  async skip() {
    return this.#station.skip();
  }

  getDeckPositions(deckIndex: DeckIndex): DeckPositions {
    return this.#station.getDeckPositions(deckIndex)
  }

  getDeckInfo(deckIndex: DeckIndex): Promise<DeckInfoWithPositions> {
    return toRemoteDeckInfoWithPositions(
      this.#station.getDeckInfo(deckIndex)
    )
  }

  getCollections() {
    return this.#station.collections.map(c => ({
      id: c.id,
      description: c.extra.description
    }));
  }

  get profiles() {
    return this.#profiles;
  }

  @PureExpose
  private set profiles(value) {
    this.#profiles = value;
  }

  private setProfiles(profiles: StationProfile[]) {
    this.profiles = profiles.map(toRemoteStationProfile);
  }

  changeProfile(id: string): boolean {
    return this.#station.changeProfile(id) !== undefined;
  }

  get currentCrate() {
    return this.#currentCrate
  }

  @PureExpose
  private set currentCrate(value) {
    this.#currentCrate = value;
  }

  changePlaySequence(crateId: string, collectionId: string): true | string {
    return this.#station.forcefullySelectCrate(crateId, collectionId);
  }

  createRequestView(topIndex?: number) {
    return new ExposedRequestView(this.#station.createRequestView(topIndex)) as unknown as Remotable<RequestCollectionView>;
  }
};

export const toRemoteStationProfile = (p: StationProfile): RemoteProfile => ({
  id: p.id,
  name: p.name,
  description: p.description,
  crates: p.crates.map(toRemoteCrate)
});

export const toRemoteCrate = (c: Crate<StationTrack>): RemoteCrate => ({
  id: c.id,
  sources: zip(c.sources, c.weights).map(([src, weight]) => ({ id: src!.id, weight: weight! })),
  limit: isFunction(c.limit) ? c.limit.sequenceLimit : c.limit,
  chances: c.chance.chances
});

export class ExposedRequestView extends BasedExposedCollectionView<TrackWithRequester<StationTrack, Requester>> implements Exposable<RequestCollectionView> {
  dispose(): void {
    super.dispose();
  }

  get length() {
    return super.length;
  }

  set length(val) {
    super.length = val;
  }

  get topIndex() {
    return super.topIndex;
  }

  set topIndex(val) {
    super.topIndex = val;
  }

  get bottomIndex() {
    return super.bottomIndex;
  }

  get ranges() {
    return super.ranges;
  }

  updateView(topIndex: number, length: number): void {
    super.updateView(topIndex, length);
  }

  absolute(localIndex: number): number {
    return super.absolute(localIndex);
  }

  isIndexInView(absoluteIndex: number): boolean {
    return super.isIndexInView(absoluteIndex);
  }

  async at(index: number) {
    return super.at(index);
  }

  async items() {
    return super.items();
  }

  itemsWithIndexes() {
    return super.itemsWithIndexes();
  }

  protected override toRemoteTrack(track: TrackWithRequester<StationTrack, Requester>): Promise<RemoteTrack> {
    return toRemoteTrack(track as any);
  }

  protected override toRemoteTrackRecord(track: TrackWithRequester<StationTrack, Requester>): Array<any> {
    const { id, extra, path, requestedBy: requesters } = track;
    const tags = extra?.tags;

    // TODO: requesters

    const r = [
      id,
      tags?.artist,
      tags?.title ?? path,
    ] satisfies RequestTrackRecord;


    return r;
  }
}
