import { TrackInfo } from "@seamless-medley/medley";
import { Crate } from "./crate";
import { TrackCollection } from "./collections";

export interface Track<E extends TrackExtra, CE = any> extends TrackInfo {
  readonly collection: TrackCollection<Track<E, CE>, CE>;

  sequencing: TrackSequencing<Track<E, CE>, CE>;

  readonly id: string;
  readonly path: string;
  musicId?: string;
  extra?: E;
}

export type TrackExtra = {
  source?: string;
}

export type TrackSequencing<T extends Track<any, CE>, CE> = {
  /**
   * The current crate it was fetched from
   */
  crate?: Crate<T, CE>;

  playOrder?: [count: number, max: number];

  latch?: [count: number, max: number];
}

export type TrackExtraOf<T> = T extends Track<infer E> ? E : never;
