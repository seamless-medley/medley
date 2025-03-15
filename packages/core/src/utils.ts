import os from 'node:os';
import { distance } from "fastest-levenshtein";
import { castArray } from "lodash";
import { AudioProperties } from "@seamless-medley/medley";
import { BoomBoxTrack } from "./playout";
import { MetadataHelper } from "./metadata";

export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const editDistance = distance(a, b);
  const longestLength = Math.max(a.length, b.length);

  return (longestLength - editDistance) / longestLength
}

export type TrackBannerOptions = {
  separators?: Partial<Record<'title' | 'artist', string>>;
}

export type SongBannerFormatOptions = {
  title?: string;
  artists?: string[] | string;
} & TrackBannerOptions;

export function formatSongBanner(options: SongBannerFormatOptions): string | undefined {
  const { title, artists, separators } = options;
  const info: string[] = [];

  if (artists) {
    info.push(castArray(artists).join(separators?.artist ?? ','));
  }

  if (title) {
    info.push(title);
  }

  return info.length ? info.join(separators?.title ?? ' - ') : undefined;
}

export function fetchAudioProps(track: BoomBoxTrack, helperDomain: string = 'audio-props'): Promise<AudioProperties> | undefined {
  const { extra } = track;

  if (!extra) {
    return;
  }

  if (extra.maybeAudioProperties === undefined) {
    extra.maybeAudioProperties = MetadataHelper.for(helperDomain, helper => helper.audioProperties(track.path));
  }

  return extra.maybeAudioProperties;
}

export function getThreadPoolSize() {
  const uv = +(process.env.UV_THREADPOOL_SIZE ?? 0);
  return uv > 0 ? uv : os.cpus().length;
}
