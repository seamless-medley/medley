import type { Track } from "./track";
import type { Exposable } from "../../../socket";
import type { TrackCollectionBasicOptions } from "../../../core";

/**
 * Although this is named as Collection, but in fact it should be used with WatchTrackCollection
 */
export interface Collection {
  readonly id: string;

  readonly description: string;

  readonly options: TrackCollectionBasicOptions;

  readonly length: number;

  readonly ready: boolean;

  clear(): void;

  // TODO: add

  // TODO: remove

  // TODO: Move

  shuffle(): void;

  all(): Promise<Track[]>;

  createView(numItems: number, topIndex?: number): Exposable<CollectionView>;

  ϟrefresh(): void;
  ϟtrackShift(track: Track): void;
  ϟtrackPush(track: Track): void;
  ϟtracksAdd(tracks: Track[]): void;
  ϟtracksRemove(tracks: Track[]): void;
}

export interface CollectionView {
  length: number;

  topIndex: number;

  readonly bottomIndex: number;

  readonly ranges: [top: number, bottom: number];

  dispose(): void;

  updateView(topIndex: number, length: number): void;

  absolute(localIndex: number): number;

  isIndexInView(absoluteIndex: number): boolean;

  at(index: number): Promise<Track | undefined>;

  items(): Promise<Track[]>;

  ϟupdate(indexes: number[]): any;
}
