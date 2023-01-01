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

  unmatchItems(scope: string): Promise<SearchRecord[]>;
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

  findById(trackId: string): Promise<MusicTrack | undefined>;

  findByPath(path: string): Promise<MusicTrack | undefined>;

  findByISRC(musicId: string): Promise<MusicTrack | undefined>;

  update(trackId: string, update: Omit<MusicTrack, 'trackId'>): Promise<void>;

  delete(trackId: string): Promise<void>;

  get searchHistory(): SearchHistory;

  get trackHistory(): TrackHistory;
}

export interface MusicTrack extends Partial<Metadata> {
  trackId: string;
  path: string;
}

/**
 * INTERNAL USE ONLY
 */
export class InMemoryMusicDb implements MusicDb {
  private tracks = new Map<string, MusicTrack>();

  async findById(trackId: string) {
    return this.tracks.get(trackId);
  }

  async findByPath(path: string) {
    return this.findById(normalizePath(path));
  }

  async findByISRC(musicId: string) {
    return undefined;
  }

  async update(trackId: string, update: Omit<MusicTrack, "trackId">) {
    const existing = this.tracks.get(trackId) ?? {};
    this.tracks.set(trackId, {
      ...existing,
      ...update
    } as MusicTrack)
  }

  async delete(trackId: string){
    this.tracks.delete(trackId);
  }

  get searchHistory(): SearchHistory {
    return this._searchHistory;
  }

  get trackHistory(): TrackHistory {
    return this._trackHistory;
  }

  private readonly _searchHistory: SearchHistory = {
    async add(scope, query) {

    },

    recentItems: async (scope, key, limit?) => [],

    unmatchItems: async (scope) => []
  }

  private readonly _trackHistory: TrackHistory = {
    async add(scope, record, max) {

    },

    getAll: async (scope) => []
  }

  dispose(): void {

  }
}
