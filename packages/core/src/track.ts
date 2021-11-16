import { TrackInfo } from "@medley/medley";
import { Crate } from "./crate";
import { TrackCollection } from "./collections";

export interface Track<M> extends TrackInfo {
  readonly collection: TrackCollection<Track<M>>;
  /**
   * The current crate it was fetched from
   */
  crate?: Crate<Track<M>>;
  readonly id: string;
  readonly path: string;
  metadata?: M;
}

export type TrackMetadata<T> = T extends Track<infer M> ? M : never;