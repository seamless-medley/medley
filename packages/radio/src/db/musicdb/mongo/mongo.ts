import { MusicDb, MusicDbTrack, SearchHistory, TrackHistory, WorkerPoolAdapter } from "@seamless-medley/core";
import { MongoClientOptions } from "mongodb";
import { ConfigDb } from "../../types";

export type Options = {
  url: string;

  connectionOptions?: MongoClientOptions;

  database: string;

  /**
   * TTL in seconds, default to 24,36 hours
   * @default [86400,129600]  (24,36 hours)
   */
   ttls?: [min: number, max: number];
}

type PrefixRemap<Prefix extends string, T> = {
  [name in keyof T as `${Prefix}${string & name}`]: T[name];
}

type WorkerMethods = MusicDb &
  PrefixRemap<'search_', SearchHistory> &
  PrefixRemap<'track_', TrackHistory>

export class MongoMusicDb extends WorkerPoolAdapter<WorkerMethods> implements MusicDb, ConfigDb {
  constructor() {
    super(__dirname + '/worker.js', {});

    this.preSpawn();
  }

  async init(options: Options): Promise<this> {
    const pool = (this.pool as any);
    await Promise.all(
      (pool.workers as any[])
        .map(worker => worker.exec('configure', [options]))
    );
    return this;
  }

  async findById(trackId: string): Promise<MusicDbTrack | undefined> {
    return this.exec('findById', trackId);
  }

  async findByPath(path: string): Promise<MusicDbTrack | undefined> {
    return this.exec('findByPath', path);
  }

  async findByISRC(musicId: string): Promise<MusicDbTrack | undefined> {
    return this.exec('findByISRC', musicId);
  }

  async update(trackId: string, fields: Omit<MusicDbTrack, 'trackId'>) {
    return this.exec('update', trackId, fields);
  }

  async delete(trackId: string): Promise<void> {
    return this.exec('delete', trackId);
  }

  readonly #searchHistory: SearchHistory = {
    add: async (stationId, query) => {
      return this.exec('search_add', stationId, query);
    },

    recentItems: async (stationId, key, limit) => {
      return this.exec('search_recentItems', stationId, key, limit);
    },

    unmatchedItems: async (stationId) => {
      return this.exec('search_unmatchedItems', stationId);
    },
  }

  get searchHistory() {
    return this.#searchHistory;
  }

  readonly #trackHistory: TrackHistory = {
    add: async (stationId, track, max) => {
      if (max > 0) {
        return this.exec('track_add', stationId, track, max);
      }
    },

    getAll: async (stationId) => {
      return this.exec('track_getAll', stationId);
    }
  }

  get trackHistory() {
    return this.#trackHistory;
  }

  dispose() {
    this.pool.terminate();
  }
}
