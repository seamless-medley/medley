import {
  type BoomBoxTrack,
  type BoomBoxTrackExtra,
  type BoomBoxTrackPlay,
  type CoverAndLyrics,
  type LatchSession as CoreLatchSession,
  isRequestTrack,
  TrackKind as CoreTrackKind
} from "@seamless-medley/core";

import { Lyrics, parseLyrics } from "@seamless-medley/utils";

import type { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";

type IdOnly<T extends { id: any }> = Writable<Pick<T, 'id'>>;

export type TrackCollection = IdOnly<BoomBoxTrack['collection']>;

export type Track = Simplify<Writable<
  ConditionalPick<BoomBoxTrack, Jsonifiable | undefined> & {
    collection: TrackCollection;
    extra?: TrackExtra;
    sequencing?: TrackSequencing;
  }
>>;

export type TrackExtra = Simplify<Writable<
  ConditionalPick<Omit<BoomBoxTrackExtra, 'kind'>, Jsonifiable | undefined> & {
    kind: TrackKind,
    coverAndLyrics?: Omit<ConditionalPick<CoverAndLyrics, Jsonifiable>, 'lyrics'> & {
      lyrics: ConditionalPick<Lyrics, Jsonifiable>
    }
  }
>>;

type Sequencing = NonNullable<BoomBoxTrack['sequencing']>;
type SequencingLatch = NonNullable<Sequencing['latch']>;

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

const trackKinds = ['normal', 'request', 'insert'] as const;

export type TrackKind = typeof trackKinds[number];

export const trackKindToString = (k: CoreTrackKind): TrackKind => trackKinds[k.valueOf()];

export const toTrack = async (
  track: BoomBoxTrack,
  noCover?: boolean
): Promise<Track> => {
  const { id, path, musicId, cueInPosition, cueOutPosition, disableNextLeadIn, extra, sequencing, collection } = track;

  const actualExtra = isRequestTrack(track) ? track.original.extra : extra;

  return {
    id,
    path,
    musicId,
    cueInPosition,
    cueOutPosition,
    disableNextLeadIn,
    extra: actualExtra ? await toTrackExtra(actualExtra, noCover) : undefined,
    sequencing: sequencing ? toTrackSequencing(sequencing): undefined,
    collection: pickId(collection)
  }
}

export const toTrackExtra = async (
  { kind, source, tags, maybeCoverAndLyrics }: BoomBoxTrackExtra,
  noCover?: boolean
): Promise<TrackExtra> => {
  const coverAndLyrics = !noCover ? await maybeCoverAndLyrics : undefined;
  const lyrics = coverAndLyrics ? parseLyrics(coverAndLyrics?.lyrics, { bpm: tags?.bpm }) : undefined;

  return {
    kind: trackKindToString(kind),
    source,
    tags,
    coverAndLyrics: coverAndLyrics ? {
      ...coverAndLyrics,
      lyrics: lyrics!
    } : undefined
  }
}

export const pickId = <T extends { id: any }>({ id }: T): IdOnly<T> => ({ id });

export const toTrackPlay = async ({ uuid, track, duration }: BoomBoxTrackPlay): Promise<TrackPlay> => ({
  uuid,
  duration,
  track: await toTrack(track),
});

export const toTrackSequencing = ({ playOrder, crate, latch }: Sequencing): TrackSequencing => ({
  playOrder,
  crate: pickId(crate),
  latch: latch ? toTrackSequencingLatch(latch) : undefined
});

export const toTrackSequencingLatch = (
  {
    order,
    session
  }: SequencingLatch
): TrackSequencingLatch => ({
  order,
  session: toLatchSession(session)
});

export const toLatchSession = (
  {
    uuid,
    count,
    max: max,
    collection
  } : NonNullable<SequencingLatch['session']>
): LatchSession => ({
  uuid,
  count,
  max: max,
  collection: pickId(collection)
})
