import type { Metadata } from "@seamless-medley/medley";
import normalizePath from "normalize-path";
import type { TrackRecord } from "../playout";
import type { SearchQuery, SearchQueryKey } from "./search";

export type RecentSearchRecord = [term: string, count: number, timestamp: Date];

export type SearchRecord = {
  artist?: string;
  title?: string;
  query?: string;
  count: number;
  timestamp: Date;
}

export interface SearchHistory {
  add(scope: string, query: SearchQuery & { resultCount?: number }): Promise<void>;

  recentItems(scope: string, key: SearchQueryKey, limit?: number): Promise<RecentSearchRecord[]>;

  unmatchedItems(scope: string): Promise<SearchRecord[]>;
}

export type TimestampedTrackRecord = TrackRecord & {
  playedTime: Date;
}

export interface TrackHistory {
  add(scope: string, record: TimestampedTrackRecord, max: number): Promise<void>;

  getAll(scope: string): Promise<TimestampedTrackRecord[]>;
}

export type UpdateInfo = {
  modified: number;
}

export type FindByCommentOptions = {
  valueDelimiter?: string;
  limit?: number;
  sort?: Partial<Record<keyof MusicDbTrack, 1 | -1>>;
}

export interface MusicDb {
  dispose(): void;

  findById(trackId: string): Promise<MusicDbTrack | undefined>;

  findByPath(path: string): Promise<MusicDbTrack | undefined>;

  findByISRC(musicId: string): Promise<MusicDbTrack | undefined>;

  findByComment(field: string, value: string, options?: FindByCommentOptions): Promise<MusicDbTrack[]>;

  update(trackId: string, update: Omit<MusicDbTrack, 'trackId'>): Promise<MusicDbTrack>;

  delete(trackId: string): Promise<void>;

  validateTracks(predicate: (trackId: string) => Promise<boolean>): Promise<[valid: number, invalid: number]>;

  get searchHistory(): SearchHistory;

  get trackHistory(): TrackHistory;
}

export interface MusicDbTrack extends Metadata {
  trackId: string;
  path: string;
  timestamp?: number;
}

/**
 * INTERNAL USE ONLY
 */
export class InMemoryMusicDb implements MusicDb {
  #tracks = new Map<string, MusicDbTrack>();

  async findById(trackId: string) {
    return this.#tracks.get(trackId);
  }

  async findByPath(path: string) {
    return this.findById(normalizePath(path));
  }

  async findByISRC(musicId: string) {
    return undefined;
  }

  async findByComment(field: string, value: string, options?: FindByCommentOptions): Promise<MusicDbTrack[]> {
    return [];
  }

  async update(trackId: string, update: Omit<MusicDbTrack, "trackId">) {
    const existing = this.#tracks.get(trackId);

    const track: MusicDbTrack = {
      trackId,
      ...existing,
      ...update
    };

    this.#tracks.set(trackId, track);

    return track;
  }

  async delete(trackId: string){
    this.#tracks.delete(trackId);
  }

  async validateTracks(predicate: (trackId: string) => Promise<boolean>): ReturnType<MusicDb['validateTracks']> {
    let invalid = 0;
    for (const track of this.#tracks.values()) {
      const valid = await predicate(track.trackId);

      if (!valid) {
        await this.delete(track.trackId);
        invalid++;
      }
    }

    return [this.#tracks.size, invalid];
  }

  get searchHistory(): SearchHistory {
    return this.#searchHistory;
  }

  get trackHistory(): TrackHistory {
    return this.#trackHistory;
  }

  readonly #searchHistory: SearchHistory = {
    async add(scope, query) {

    },

    recentItems: async (scope, key, limit?) => [],

    unmatchedItems: async (scope) => []
  }

  readonly #trackHistory: TrackHistory = {
    async add(scope, record, max) {

    },

    getAll: async (scope) => []
  }

  dispose(): void {

  }
}
