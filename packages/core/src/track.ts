import { TrackInfo } from "@seamless-medley/medley";
import { Crate } from "./crate";
import { TrackCollection } from "./collections";

export interface Track<E, CE = never> extends TrackInfo {
  readonly collection: TrackCollection<Track<E>, CE>;

  sequencing: TrackSequencing<E, CE>;

  readonly id: string;
  readonly path: string;
  musicId?: string;
  extra?: E;
}

export type TrackSequencing<E, CE> = {
  /**
   * The current crate it was fetched from
   */
  crate?: Crate<Track<E>, CE>;

  playOrder?: [count: number, max: number];

  latch?: [count: number, max: number];
}

export type TrackExtra<T> = T extends Track<infer E> ? E : never;
