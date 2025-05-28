import { clamp, inRange, range, isEqual } from "lodash";
import { TypedEmitter } from "tiny-typed-emitter";
import type { Track, TrackExtra, TrackExtraOf } from "../track";
import type { TrackCollection, TrackCollectionEvents } from "./base";

export type TrackCollectionViewEvents = {
  update: (indexes: number[]) => any;
}

export class TrackCollectionView<
  T extends Track<TE>,
  TE extends TrackExtra = TrackExtraOf<T>
> extends TypedEmitter<TrackCollectionViewEvents> {
  #collection: TrackCollection<T, TE>;
  #numItems: number = 0;
  #topIndex: number = 0;

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

  #handleTrackUpdate: TrackCollectionEvents<T>['tracksUpdate'] = ({ tracks }) => {
    const changedIndexes: number[] = [];

    const currentIds = new Map(this.#trackIds.map((id, index) => [id, index]));

    for (const track of tracks) {
      const index = currentIds.get(track.id);
      if (index) {
        changedIndexes.push(index);
      }
    }

    if (changedIndexes.length) {
      this.emit('update', changedIndexes);
    }
  }

  #handleRefresh: TrackCollectionEvents<T>['refresh'] = () => {
    this.#invalidate();
  }

  #invalidate(newIds?: string[]): boolean {
    if (newIds === undefined) {
      const [start, end] = this.ranges;

      newIds = range(start, end + 1)
        .map(index => this.#collection.at(index)?.id)
        .filter((id): id is string => id !== undefined);
    }

    if (isEqual(this.#trackIds, newIds)) {
      return false;
    }

    this.#trackIds = newIds;

    const changedIndexes = newIds
      .map((id, index) => id !== this.#trackIds[index] ? index : undefined)
      .filter((index): index is number => index !== undefined);

    if (changedIndexes.length) {
      this.emit('update', changedIndexes);
    }

    return true;
  }

  get collection() {
    return this.#collection;
  }

  get length() {
    return Math.min(this.#topIndex + this.#numItems, this.#collection.length) - this.#topIndex;
  }

  set length(val) {
    if (val === this.#numItems) {
      return;
    }

    this.#numItems = val;
    this.#numItems = this.length;
    this.#invalidate();
  }

  /**
   * The first absolute item index in the view
   */
  get topIndex() {
    return this.#topIndex;
  }

  set topIndex(val) {
    const newIndex = clamp(val, 0, this.#collection.length - 1);
    if (newIndex === this.#topIndex) {
      return;
    }

    this.#invalidate();
  }

  /**
   * The last absolute item index in the view
   */
  get bottomIndex() {
    return this.#topIndex + this.length - 1;
  }

  /**
   * The tuple of absolute top and bottom item indexes in the view
   */
  get ranges(): [top: number, bottom: number] {
    return [this.topIndex, this.bottomIndex];
  }

  updateView(topIndex: number, length: number) {
    this.#topIndex = topIndex;
    this.length = length;
    this.#invalidate();
  }

  *[Symbol.iterator](): Iterator<T, any, undefined> {
    const [from, to] = this.ranges;

    for (let i = from; i <= to; i++) {
      if (i >= this.#collection.length) break;
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
   * Convert the local index of the view to the absolute index of the underlying collection
   * Return -1 if the local index is not in the view
   */
  absolute(localIndex: number) {
    const abs = this.topIndex + localIndex;
    return this.isIndexInView(abs) ? abs : -1;
  }

  /**
   * Accessing item from the underlying collection with local index relative to the view
   */
  at(index: number) {
    return this.#collection.at(this.absolute(index));
  }

  isIndexInView(absoluteIndex: number) {
    const [l, h] = this.ranges;
    return inRange(absoluteIndex, l, h + 1);
  }
}
