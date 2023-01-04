import type {
  BoomBoxTrack,
  BoomBoxTrackExtra,
  BoomBoxTrackPlay,
  CoverAndLyrics
} from "@seamless-medley/core";

import type { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";

export type TrackCollection = Writable<Pick<BoomBoxTrack['collection'], 'id'>>;

export type Track = Simplify<Writable<
  ConditionalPick<BoomBoxTrack, Jsonifiable | undefined> & {
    collection: TrackCollection;
    extra?: TrackExtra;
  }
>>;

export type TrackExtra = Simplify<Writable<
  ConditionalPick<BoomBoxTrackExtra, Jsonifiable | undefined> & {
    coverAndLyrics?: ConditionalPick<CoverAndLyrics, Jsonifiable>;
  }
>>;

export type TrackPlay = Simplify<Writable<
  ConditionalPick<BoomBoxTrackPlay, Jsonifiable | undefined> & {
    track: Track;
  }
>>;

export const fromBoomBoxTrack = async (
  { id, path, musicId, cueInPosition, cueOutPosition, disableNextLeadIn, extra, collection }: BoomBoxTrack
): Promise<Track> => ({
  id,
  path,
  musicId,
  cueInPosition,
  cueOutPosition,
  disableNextLeadIn,
  extra: extra ? await fromBoomBoxTrackExtra(extra) : undefined,
  collection: fromBoomBoxTrackCollection(collection)
})

export const fromBoomBoxTrackExtra = async ({ kind, source, tags, maybeCoverAndLyrics }: BoomBoxTrackExtra): Promise<TrackExtra> => ({
  kind,
  source,
  tags,
  coverAndLyrics: await maybeCoverAndLyrics
})

export const fromBoomBoxTrackCollection = ({ id }: BoomBoxTrack['collection']): TrackCollection => ({ id });

export const fromBoomBoxTrackPlay = async ({ uuid, track }: BoomBoxTrackPlay): Promise<TrackPlay> => ({
  uuid,
  track: await fromBoomBoxTrack(track)
})
