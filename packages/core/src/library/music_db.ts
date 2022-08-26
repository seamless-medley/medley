import type { Metadata } from "@seamless-medley/medley";
import type { TrackRecord } from "../playout";
import type { Station } from "../station";
import type { SearchQuery, SearchQueryKey } from "./search";

export type RecentSearch = [term: string, count: number, timestamp: Date];

type StationId = Station['id'];
export interface SearchHistory {
  add(stationId: StationId, query: SearchQuery & { resultCount?: number }): Promise<void>;

  recentItems(stationId: StationId, key: SearchQueryKey, limit?: number): Promise<RecentSearch[]>;
}

export type TimestampedTrackRecord = TrackRecord & {
  playedTime: Date;
}

export interface TrackHistory {
  add(stationId: StationId, record: TimestampedTrackRecord, max: number): Promise<void>;

  getAll(stationId: StationId): Promise<TimestampedTrackRecord[]>;
}

export interface MusicDb {
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
