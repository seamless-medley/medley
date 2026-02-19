import { isFunction, isObject, omitBy } from "lodash";

import type {
  MusicTrack,
  MusicTrackCollection,
  MusicTrackCollectionEvents,
  Station,
  Track as CoreTrack,
  TrackCollectionView,
} from "../../../core";

import { MixinEventEmitterOf } from "../../socket";

import type {
  BaseCollectionView,
  Collection,
  CollectionView,
  Exposable,
  Notify,
  Remotable,
  Track as RemoteTrack
} from "@seamless-medley/remote";
import { toRemoteTrackRecord, toRemoteTrack } from "./track";

export class ExposedCollection extends MixinEventEmitterOf<Collection>() implements Exposable<Collection> {
  $Exposing: MusicTrackCollection<Station>;
  $Kind = 'collection';

  notify!: Notify<Collection>;

  constructor(collection: MusicTrackCollection<Station>) {
    super();

    this.$Exposing = collection;

    this.#collection.on('refresh', this.#onRefresh);
    this.#collection.on('trackShift', this.#onTracksShift);
    this.#collection.on('trackPush', this.#onTracksPush);
    this.#collection.on('tracksAdd', this.#onTracksAdd);
    this.#collection.on('tracksRemove', this.#onTracksRemove);
  }

  dispose() {
    this.#collection.off('refresh', this.#onRefresh);
    this.#collection.off('trackShift', this.#onTracksShift);
    this.#collection.off('trackPush', this.#onTracksPush);
    this.#collection.off('tracksAdd', this.#onTracksAdd);
    this.#collection.off('tracksRemove', this.#onTracksRemove);
  }

  get #collection() {
    return this.$Exposing;
  }

  #onRefresh: MusicTrackCollectionEvents<Station>['refresh'] = () => {
    this.emit('refresh');
  }

  #onTracksShift: MusicTrackCollectionEvents<Station>['trackShift'] = async (track) => {
    this.emit('trackShift', await toRemoteTrack(track, true));
  }

  #onTracksPush: MusicTrackCollectionEvents<Station>['trackPush'] = async (track) => {
    this.emit('trackPush', await toRemoteTrack(track, true));
  }

  #onTracksAdd: MusicTrackCollectionEvents<Station>['tracksAdd'] = async (tracks) => {
    this.notify('length', this.length);

    this.emit('tracksAdd',
      await Promise.all(tracks.map(t => toRemoteTrack(t, true)))
    );
  }

  #onTracksRemove: MusicTrackCollectionEvents<Station>['tracksRemove'] = async (tracks) => {
    this.notify('length', this.length);

    this.emit('tracksRemove',
      await Promise.all(tracks.map(t => toRemoteTrack(t, true)))
    );
  }

  get id() {
    const { owner: station } = this.#collection.extra;
    return `${station.id}/${this.#collection.id}`;
  }

  get description() {
    return this.#collection.extra.description;
  }

  get options() {
    return omitBy(this.#collection.options, v => isObject(v) || isFunction(v));
  }

  get length() {
    return this.#collection.length;
  }

  get ready() {
    return this.#collection.ready;
  }

  clear() {
    this.#collection.clear();
  }

  shuffle() {
    this.#collection.shuffle();
  }

  async all() {
    return Promise.all(this.#collection.all().map(t => toRemoteTrack(t, true)));
  }

  createView(numItems: number, topIndex?: number) {
    // This casting is required because the type presented to the client must be `Remotable` instead of `Exposable`
    return new ExposedCollectionView(this.#collection.createView(numItems, topIndex)) as unknown as Remotable<CollectionView>;
  }
}

export abstract class BasedExposedCollectionView<T extends CoreTrack<any>> extends MixinEventEmitterOf<BaseCollectionView<any>>() {
  $Exposing: TrackCollectionView<T>;
  $Kind = 'collection_view';
  notify!: Notify<CollectionView>;

  constructor(view: TrackCollectionView<T>) {
    super();

    this.$Exposing = view;

    view.on('viewChange',  this.#onViewChange);
  }

  dispose(): void {
    this.#view.off('viewChange',  this.#onViewChange);
    this.#view.dispose();
  }

  #onViewChange = () => {
    this.emit('viewChange');
  }

  get #view() {
    return this.$Exposing;
  }

  get length() {
    return this.#view.length;
  }

  set length(val) {
    this.#view.length = val;
  }

  get topIndex() {
    return this.#view.topIndex;
  }

  set topIndex(val) {
    this.#view.topIndex = val;
  }

  get bottomIndex() {
    return this.#view.bottomIndex;
  }

  get ranges() {
    return this.#view.ranges;
  }

  updateView(topIndex: number, length: number): void {
    this.#view.updateView(topIndex, length);
  }

  absolute(localIndex: number): number {
    return this.#view.absolute(localIndex);
  }

  isIndexInView(absoluteIndex: number): boolean {
    return this.#view.isIndexInView(absoluteIndex);
  }

  protected abstract toRemoteTrack(track: T): Promise<RemoteTrack>;

  protected abstract toRemoteMetadataOnlyTrack(track: T): Array<any>;

  async at(index: number) {
    const track = this.#view.at(index);
    return track ? this.toRemoteTrack(track) : undefined;
  }

  async items() {
    return Promise.all(this.#view.items().map(item => this.toRemoteTrack(item)));
  }

  itemsWithIndexes(): Array<[index: number, track: any]> {
    return this.#view
      .itemsWithIndexes()
      .map(([index, track]) =>
        [
          index,
          this.toRemoteMetadataOnlyTrack(track)
        ] as [index: number, track: any]
      );
  }
}

export class ExposedCollectionView extends BasedExposedCollectionView<MusicTrack<Station>> implements Exposable<CollectionView> {
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

  protected override toRemoteTrack(track: MusicTrack<Station>): Promise<RemoteTrack> {
    return toRemoteTrack(track);
  }

  protected override toRemoteMetadataOnlyTrack(track: MusicTrack<Station>): Array<any> {
    return toRemoteTrackRecord(track);
  }
}
