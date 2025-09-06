import { clamp, inRange, range, isEqual } from "lodash";
import { TypedEmitter } from "tiny-typed-emitter";
import type { Track, TrackExtra, TrackExtraOf } from "../track";
import type { TrackCollection, TrackCollectionEvents } from "./base";

export type TrackCollectionViewEvents = {
  viewChange: () => any;
}

export class TrackCollectionView<
  T extends Track<TE>,
  TE extends TrackExtra = TrackExtraOf<T>
> extends TypedEmitter<TrackCollectionViewEvents> {
  #collection: TrackCollection<T, TE>;
  #numItems: number = 0;
  #topIndex: number = 0;

  /**
   * Current track id in the view
   */
  #trackIds: string[] = [];

  constructor(collection: TrackCollection<T, TE>, numItems: number, topIndex: number = 0) {
    super();

    this.#collection = collection;
    this.#topIndex = topIndex;
    this.length = numItems;

    collection.on('trackShift', this.#handleTrackShift);
    collection.on('trackPush', this.#handleTrackPush);
    collection.on('tracksAdd', this.#handleTrackAdd);
    collection.on('tracksRemove', this.#handleTrackRemove);
    collection.on('tracksUpdate', this.#handleTrackUpdate);
    collection.on('refresh', this.#handleRefresh);

    this.#invalidate();
  }

  dispose() {
    this.#collection.off('trackShift', this.#handleTrackShift);
    this.#collection.off('trackPush', this.#handleTrackPush);
    this.#collection.off('tracksAdd', this.#handleTrackAdd);
    this.#collection.off('tracksRemove', this.#handleTrackRemove);
    this.#collection.off('tracksUpdate', this.#handleTrackUpdate);
    this.#collection.off('refresh', this.#handleRefresh);
  }

  #handleTrackShift: TrackCollectionEvents<T>['trackShift'] = () => {
    this.#invalidate();
  }

  #handleTrackPush: TrackCollectionEvents<T>['trackPush'] = () => {
    this.#invalidate();
  }

  #handleTrackAdd: TrackCollectionEvents<T>['tracksAdd'] = () => {
    this.#invalidate();
  }

  #handleTrackRemove: TrackCollectionEvents<T>['tracksRemove'] = () => {
    this.#invalidate();
  }

  #handleTrackUpdate: TrackCollectionEvents<T>['tracksUpdate'] = () => {
    this.emit('viewChange');
  }

  #handleRefresh: TrackCollectionEvents<T>['refresh'] = () => {
    this.#invalidate({ force: true });
  }

  #getValidTopIndex(desiredTopIndex: number): number {
    if (this.#collection.length === 0) {
      return 0;
    }

    let validTopIndex = clamp(desiredTopIndex, 0, this.#collection.length - 1);

    const maxTopIndex = Math.max(0, this.#collection.length - this.#numItems);

    if (validTopIndex > maxTopIndex) {
      validTopIndex = maxTopIndex;
    }

    return validTopIndex;
  }

  #invalidate(options: { force?: boolean, noEmit?: boolean } = {}): boolean {
    const [start, end] = this.ranges;
    const newIds = range(start, end + 1)
      .map(index => this.#collection.at(index)?.id)
      .filter((id): id is string => id !== undefined);

    if (!options.force) {
      const oldIds = this.#trackIds;

      if (isEqual(oldIds, newIds)) {
        return false;
      }
    }

    this.#trackIds = newIds;

    if (!options.noEmit) {
      this.emit('viewChange');
    }

    return true;
  }

  get collection() {
    return this.#collection;
  }

  get length() {
    return Math.min(this.#numItems, this.#collection.length);
  }

  set length(val) {
    if (val === this.#numItems) {
      return;
    }

    this.#numItems = val;
    this.#invalidate({ noEmit: true });
  }

  /**
   * The first absolute item index in the view
   */
  get topIndex() {
    return this.#topIndex;
  }

  set topIndex(val) {
    const newIndex = this.#getValidTopIndex(val);
    if (newIndex === this.#topIndex) {
      return;
    }

    this.#topIndex = newIndex;
    this.#invalidate({ noEmit: true });
  }

  /**
   * The last absolute item index in the view
   */
  get bottomIndex() {
    return Math.min(this.#topIndex + this.length - 1, this.#collection.length - 1);
  }

  /**
   * The tuple of absolute top and bottom item indexes in the view
   */
  get ranges(): [top: number, bottom: number] {
    return [this.topIndex, this.bottomIndex];
  }

  updateView(topIndex: number, length: number) {
    this.length = length;
    this.#topIndex = this.#getValidTopIndex(topIndex);
    this.#invalidate({ noEmit: true });
  }

  *[Symbol.iterator](): Iterator<T, any, undefined> {
    const [from, to] = this.ranges;

    for (let i = from; i <= to; i++) {
      yield this.#collection.at(i)!;
    }
  }

  /**
   * Return list of all items in the view
   */
  items() {
    return Array.from(this);
  }

  /**
   * Return a record with absolute indexes as keys and items as values
   */
  itemsWithIndexes() {
    const [from, to] = this.ranges;
    return range(from, to + 1)
      .map<[index: number, item: T]>(i => [i, this.#collection.at(i)!])
  }

  /**
   * Convert the local index of the view to the absolute index of the underlying collection
   * Returns -1 if the local index is not in the view
   */
  absolute(localIndex: number) {
    const abs = this.topIndex + localIndex;
    return this.isIndexInView(abs) ? abs : -1;
  }

  /**
   * Access item from the underlying collection with local index relative to the view
   */
  at(index: number) {
    return this.#collection.at(this.absolute(index));
  }

  isIndexInView(absoluteIndex: number) {
    const [l, h] = this.ranges;
    return inRange(absoluteIndex, l, h + 1);
  }
}
