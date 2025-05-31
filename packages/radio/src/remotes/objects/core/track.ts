import type { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";
import type { CoverAndLyrics } from "@seamless-medley/medley";
import type { Lyrics } from "@seamless-medley/utils";

import type { Collection } from "./collection";

import {
  type BoomBoxTrack,
  type BoomBoxTrackExtra,
  type BoomBoxTrackPlay,
  type LatchSession as CoreLatchSession
} from "../../../core";

export type IdOnly<T extends { id: any }> = Writable<Pick<T, 'id'>>;

export type TrackCollection = Pick<Collection, 'id' | 'description'>;

export type Track = Simplify<Writable<
  ConditionalPick<BoomBoxTrack, Jsonifiable | undefined> & {
    collection: TrackCollection;
    extra?: TrackExtra;
    sequencing?: TrackSequencing;
  }
>>;

export type TrackKind = 'normal' | 'request' | 'insert';

export type TrackExtra = Simplify<Writable<
  ConditionalPick<Omit<BoomBoxTrackExtra, 'kind'>, Jsonifiable | undefined> & {
    kind: TrackKind,
    coverAndLyrics?: Omit<ConditionalPick<CoverAndLyrics, Jsonifiable>, 'lyrics'> & {
      lyrics: Lyrics;
    }
  }
>>;

export type Sequencing = NonNullable<BoomBoxTrack['sequencing']>;
export type SequencingLatch = NonNullable<Sequencing['latch']>;

export type TrackSequencing = Simplify<Writable<
  ConditionalPick<Sequencing, Jsonifiable | undefined> & {
    crate: IdOnly<Sequencing['crate']>;
    latch?: TrackSequencingLatch;
  }
>>;

export type TrackPlay = Simplify<Writable<
  ConditionalPick<BoomBoxTrackPlay, Jsonifiable | undefined> & {
    track: Track;
  }
>>;

export type TrackSequencingLatch = Simplify<Writable<
  ConditionalPick<SequencingLatch, Jsonifiable | undefined> & {
    session: LatchSession;
  }
>>;

export type LatchSession = Simplify<Writable<
  ConditionalPick<CoreLatchSession<BoomBoxTrack, BoomBoxTrackExtra>, Jsonifiable | undefined> & {
    collection: TrackCollection;
  }
>>;
