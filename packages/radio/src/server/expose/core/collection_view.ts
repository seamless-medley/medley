import type {
  BaseCollectionView,
  Notify,
  Track as RemoteTrack
} from "@seamless-medley/remote";

import type {
  Track as CoreTrack,
  TrackCollectionView,
} from "../../../core";

import { MixinEventEmitterOf } from "../../socket";

export abstract class BasedExposedCollectionView<T extends CoreTrack<any>> extends MixinEventEmitterOf<BaseCollectionView<any>>() {
  $Exposing: TrackCollectionView<T>;
  $Kind = 'collection_view';
  notify!: Notify<BaseCollectionView<any>>;

  constructor(view: TrackCollectionView<T>) {
    super();

    this.$Exposing = view;

    view.on('viewChange', this.#onViewChange);
  }

  dispose(): void {
    this.#view.off('viewChange', this.#onViewChange);
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

  protected abstract toRemoteTrackRecord(track: T): Promise<any[]>;

  async at(index: number) {
    const track = this.#view.at(index);
    return track ? this.toRemoteTrack(track) : undefined;
  }

  async items() {
    return Promise.all(this.#view.items().map(item => this.toRemoteTrack(item)));
  }

  async itemsWithIndexes(): Promise<Array<[index: number, track: any]>> {
    return Promise.all(this.#view.itemsWithIndexes().map(async ([index, track]) => [index, await this.toRemoteTrackRecord(track)] as [number, any]));
  }
}
