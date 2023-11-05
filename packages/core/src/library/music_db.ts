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

export interface MusicDb {
  dispose(): void;

  findById(trackId: string): Promise<MusicDbTrack | undefined>;

  findByPath(path: string): Promise<MusicDbTrack | undefined>;

  findByISRC(musicId: string): Promise<MusicDbTrack | undefined>;

  update(trackId: string, update: Omit<MusicDbTrack, 'trackId'>): Promise<void>;

  delete(trackId: string): Promise<void>;

  get searchHistory(): SearchHistory;

  get trackHistory(): TrackHistory;
}

export interface MusicDbTrack extends Metadata {
  trackId: string;
  path: string;
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

  async update(trackId: string, update: Omit<MusicDbTrack, "trackId">) {
    const existing = this.#tracks.get(trackId) ?? {};
    this.#tracks.set(trackId, {
      ...existing,
      ...update
    } as MusicDbTrack)
  }

  async delete(trackId: string){
    this.#tracks.delete(trackId);
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
