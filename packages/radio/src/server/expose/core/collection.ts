import { isFunction, isObject, omitBy } from "lodash";

import type {
  MusicTrack,
  MusicTrackCollection,
  MusicTrackCollectionEvents,
  Station,
  TrackCollectionView,
} from "../../../core";

import { MixinEventEmitterOf } from "../../socket";

import type {
  Collection,
  CollectionView,
  Exposable,
  MetadataOnlyTrack,
  Remotable
} from "@seamless-medley/remote";
import { toRemoteMetadataOnlyTrack, toRemoteTrack } from "./track";

export class ExposedCollection extends MixinEventEmitterOf<Collection>() implements Exposable<Collection> {
  $Exposing: MusicTrackCollection<Station>;
  $Kind = 'collection';

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
    this.emit('tracksAdd',
      await Promise.all(tracks.map(t => toRemoteTrack(t, true)))
    );
  }

  #onTracksRemove: MusicTrackCollectionEvents<Station>['tracksRemove'] = async (tracks) => {
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

  createView(numItems: number, topIndex?: number): Exposable<CollectionView> {
    return new ExposedCollectionView(this.#collection.createView(numItems, topIndex));
  }
}

export class ExposedCollectionView extends MixinEventEmitterOf<CollectionView>() implements Exposable<CollectionView> {
  $Exposing: TrackCollectionView<MusicTrack<Station>>;
  $Kind = 'collection_view';

  constructor(collection: TrackCollectionView<MusicTrack<Station>>) {
    super();

    this.$Exposing = collection;
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

  dispose(): void {
    this.#view.dispose();
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

  async at(index: number) {
    const track = this.#view.at(index);
    return track ? toRemoteTrack(track) : undefined;
  }

  async items() {
    return Promise.all(this.#view.items().map(item => toRemoteTrack(item)));
  }
}
