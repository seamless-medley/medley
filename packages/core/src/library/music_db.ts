import type { Metadata } from "@seamless-medley/medley";
import type { SearchQuery, SearchQueryKey } from "./search";

export type RecentSearch = [term: string, count: number, timestamp: Date];

export interface SearchHistory {
  add(query: SearchQuery): Promise<void>;

  recentItems(key: SearchQueryKey, limit?: number): Promise<RecentSearch[]>;
}

// TODO: TrackHistory
export interface TrackHistory {
  // add(track: any): Promise<void>;

  // getAll(): Promise<any[]>;
}

export interface MusicDb {
  findById(trackId: string): Promise<MusicTrack | undefined>;

  findByPath(path: string): Promise<MusicTrack | undefined>;

  findByISRC(musicId: string): Promise<MusicTrack | undefined>;

  update(trackId: string, update: Omit<MusicTrack, 'trackId'>): Promise<void>;

  delete(trackId: string): Promise<void>;

  get searchHistory(): SearchHistory;

  // get trackHistory(): TrackHistory;
}

export interface MusicTrack extends Partial<Metadata> {
  trackId: string;
  path: string;
}
