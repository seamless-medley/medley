import { MusicDb, MusicTrack, SearchHistory, TrackHistory } from "@seamless-medley/core";
import { WorkerPoolAdapter } from "@seamless-medley/core/src/worker_pool_adapter";
import { MongoClientOptions } from "mongodb";

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

export class MongoMusicDb extends WorkerPoolAdapter<WorkerMethods> implements MusicDb {
  constructor() {
    super(__dirname + '/worker.js', {});

    this.preSpawn();
  }

  async init(options: Options): Promise<this> {
    const pool = (this.pool as any);
    for (const worker of pool.workers as any[]) {
      await worker.exec('configure', [options]);
    }

    return this;
  }

  async findById(trackId: string): Promise<MusicTrack | undefined> {
    return this.exec('findById', trackId);
  }

  async findByPath(path: string): Promise<MusicTrack | undefined> {
    return this.exec('findByPath', path);
  }

  async findByISRC(musicId: string): Promise<MusicTrack | undefined> {
    return this.exec('findByISRC', musicId);
  }

  async update(trackId: string, fields: Omit<MusicTrack, 'trackId'>) {
    return this.exec('update', trackId, fields);
  }

  async delete(trackId: string): Promise<void> {
    return this.exec('delete', trackId);
  }

  private readonly _searchHistory: SearchHistory = {
    add: async (stationId, query) => {
      return this.exec('search_add', stationId, query);
    },

    recentItems: async (stationId, key) => {
      return this.exec('search_recentItems', stationId, key);
    }
  }

  get searchHistory() {
    return this._searchHistory;
  }

  private readonly _trackHistory: TrackHistory = {
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
    return this._trackHistory;
  }
}
