import { TrackCollectionBasicOptions } from "@seamless-medley/core";
import { Track } from "../po/track";

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
  ϟtracksAdd(tracks: Track[], indexes: number[]): void;
  ϟtracksRemove(tracks: Track[], indexes?: number[]): void;
}
