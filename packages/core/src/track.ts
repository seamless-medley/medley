import { TrackInfo } from "@seamless-medley/medley";
import { Crate } from "./crate";
import { TrackCollection } from "./collections";

export interface Track<M, CM = never> extends TrackInfo {
  readonly collection: TrackCollection<Track<M>, CM>;
  /**
   * The current crate it was fetched from
   */
  crate?: Crate<Track<M>, CM>;
  readonly id: string;
  readonly path: string;
  metadata?: M;
}

export type TrackMetadata<T> = T extends Track<infer M> ? M : never;