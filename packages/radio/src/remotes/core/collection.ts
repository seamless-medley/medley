import type { Track } from "./track";
import type { TrackCollectionBasicOptions } from "../../core";

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

  ϟrefresh(): void;
  ϟtrackShift(track: Track): void;
  ϟtrackPush(track: Track): void;
  ϟtracksAdd(tracks: Track[]): void;
  ϟtracksRemove(tracks: Track[]): void;
}
