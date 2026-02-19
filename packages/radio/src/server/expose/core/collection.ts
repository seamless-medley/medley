import { isFunction, isObject, omitBy } from "lodash";

import type {
  MusicTrack,
  MusicTrackCollection,
  MusicTrackCollectionEvents,
  Station
} from "../../../core";

import { MixinEventEmitterOf } from "../../socket";

import type {
  Collection,
  CollectionView,
  Exposable,
  Notify,
  Remotable,
  Track as RemoteTrack
} from "@seamless-medley/remote";
import { toRemoteTrackRecord, toRemoteTrack } from "./track";
import { BasedExposedCollectionView } from "./collection_view";

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
