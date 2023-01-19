import { TrackInfo } from "@seamless-medley/medley";
import { Crate, LatchSession } from "./crate";
import { TrackCollection } from "./collections";

export interface Track<E extends TrackExtra> extends TrackInfo {
  readonly collection: TrackCollection<Track<E>>;

  sequencing?: TrackSequencing<Track<E>, E>;

  readonly id: string;
  readonly path: string;
  musicId?: string;
  extra?: E;
}

export type TrackExtra = {
  source?: string;
}

export type TrackExtraOf<T extends Track<any>> = T extends Track<infer E> ? E : never;

export type TrackSequencingLatch<T extends Track<E>, E extends TrackExtra> = {
    /**
     * Track order in this latch
     */
    order: number;
    session: LatchSession<T, E>;
}

export type TrackSequencing<T extends Track<E>, E extends TrackExtra> = {
  /**
   * The current crate it was fetched from
   */
  crate: Crate<T>;

  playOrder: [count: number, max: number];

  latch?: TrackSequencingLatch<T, E>;
}

export type SequencedTrack<T extends Track<any>> = Omit<T, 'sequencing'> & {
  sequencing: TrackSequencing<T, T['extra']>;
}

export type TrackWithCollectionExtra<T extends Track<any>, Extra> = Omit<T, 'collection'> & {
  readonly collection: TrackCollection<T, Extra>;
}
