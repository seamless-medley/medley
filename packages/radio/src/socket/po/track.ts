import type {
  BoomBoxTrack,
  BoomBoxTrackExtra,
  BoomBoxTrackPlay,
  CoverAndLyrics,
  LatchSession as CoreLatchSession
} from "@seamless-medley/core";

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
  ConditionalPick<BoomBoxTrackExtra, Jsonifiable | undefined> & {
    coverAndLyrics?: ConditionalPick<CoverAndLyrics, Jsonifiable>;
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

export const toTrack = async (
  { id, path, musicId, cueInPosition, cueOutPosition, disableNextLeadIn, extra, sequencing, collection }: BoomBoxTrack,
  noCover?: boolean
): Promise<Track> => ({
  id,
  path,
  musicId,
  cueInPosition,
  cueOutPosition,
  disableNextLeadIn,
  extra: extra ? await toTrackExtra(extra, noCover) : undefined,
  sequencing: sequencing ? toTrackSequencing(sequencing): undefined,
  collection: pickId(collection)
})

export const toTrackExtra = async (
  { kind, source, tags, maybeCoverAndLyrics }: BoomBoxTrackExtra,
  noCover?: boolean
): Promise<TrackExtra> => ({
  kind,
  source,
  tags,
  coverAndLyrics: !noCover ? await maybeCoverAndLyrics : undefined
})

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
    max,
    collection
  } : NonNullable<SequencingLatch['session']>
): LatchSession => ({
  uuid,
  count,
  max,
  collection: pickId(collection)
})
