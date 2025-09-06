import { parseLyrics } from "@seamless-medley/utils";

import type {
  BoomBoxTrack,
  TrackKind as CoreTrackKind,
  BoomBoxTrackExtra,
  BoomBoxTrackPlay
} from "../../../core";

import {
  isRequestTrack,
} from "../../../core";

import type {
  IdOnly,
  LatchSession,
  Sequencing,
  SequencingLatch,
  Track,
  TrackCollection,
  TrackExtra,
  TrackKind,
  TrackPlay,
  TrackSequencing,
  TrackSequencingLatch,
  MetadataOnlyTrack
} from "@seamless-medley/remote";

export const toRemoteTrack = async (
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
    extra: actualExtra ? await toRemoteTrackExtra(actualExtra, noCover) : undefined,
    sequencing: sequencing ? toRemoteTrackSequencing(sequencing): undefined,
    collection: toRemoteTrackCollection(collection)
  }
}

const trackKinds = ['normal', 'request', 'insert'] as const;

export const trackKindToString = (k: CoreTrackKind): TrackKind => trackKinds[k.valueOf()];

export const toRemoteMetadataOnlyTrack = (track: BoomBoxTrack): MetadataOnlyTrack => {
  const { id, extra, path } = track;
  const tags = extra?.tags;
  return [
    id,
    extra?.kind ? trackKindToString(extra.kind) : 'normal',
    tags?.artist, tags?.title ?? path, tags?.album
  ]
}

export const toRemoteTrackExtra = async (
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

const pickId = <T extends { id: any }>({ id }: T): IdOnly<T> => ({ id });

export const toRemoteTrackSequencing = ({ playOrder, crate, latch }: Sequencing): TrackSequencing => ({
  playOrder,
  crate: pickId(crate),
  latch: latch ? toRemoteTrackSequencingLatch(latch) : undefined
});

export const toRemoteTrackCollection = (collection: BoomBoxTrack['collection']): TrackCollection => {
  return {
    id: collection.id,
    description: collection.extra?.description
  }
}

export const toRemoteTrackSequencingLatch = (
  {
    order,
    session
  }: SequencingLatch
): TrackSequencingLatch => ({
  order,
  session: toRemoteLatchSession(session)
});

export const toRemoteLatchSession = (
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
  collection: toRemoteTrackCollection(collection)
})

export const toRemoteTrackPlay = async ({ uuid, track, duration }: BoomBoxTrackPlay): Promise<TrackPlay> => ({
  uuid,
  duration,
  track: await toRemoteTrack(track),
});
