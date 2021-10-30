import { TrackInfo } from "@medley/medley";
import { Crate } from "./crate";
import { TrackCollection } from "./collections";

export interface Track<M = void> extends TrackInfo {
  readonly collection: TrackCollection<M>;
  /**
   * The current crate it was fetched from
   */
  crate?: Crate<M>;
  readonly path: string;
  metadata?: M;
}