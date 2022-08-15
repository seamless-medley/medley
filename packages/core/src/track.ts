import { TrackInfo } from "@seamless-medley/medley";
import { Crate } from "./crate";
import { TrackCollection } from "./collections";

export type MusicIdendifier = {
  id: Track<any>['id'];
  musicId?: Track<any>['musicId'];
}

export interface Track<E, CE = never> extends TrackInfo {
  readonly collection: TrackCollection<Track<E>, CE>;
  /**
   * The current crate it was fetched from
   */
  crate?: Crate<Track<E>, CE>;
  readonly id: string;
  readonly path: string;
  musicId?: string;
  extra?: E;
}

export type TrackExtra<T> = T extends Track<infer E> ? E : never;
