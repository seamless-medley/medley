import { FindByCommentOptions, MusicDb, MusicDbTrack, SearchHistory, TrackHistory, WorkerPoolAdapter } from "@seamless-medley/core";
import { MongoClientOptions } from "mongodb";
import { SettingsDb } from "../../types";
import { PlainUser, User } from "../../persistent/user";

export type Options = {
  url: string;

  connectionOptions?: MongoClientOptions;

  database: string;

  /**
   * TTL in seconds, default to 24,36 hours
   * @default [86400,129600]  (24,36 hours)
   */
   ttls?: [min: number, max: number];

   seed?: true;
}

type PrefixRemap<Prefix extends string, T> = {
  [name in keyof T as `${Prefix}${string & name}`]: T[name];
}

type WorkerMethods = MusicDb &
  PrefixRemap<'search_', SearchHistory> &
  PrefixRemap<'track_', TrackHistory> &
  PrefixRemap<'settings_', SettingsDb>

export class MongoMusicDb extends WorkerPoolAdapter<WorkerMethods> implements MusicDb {
  constructor() {
    super(__dirname + '/worker.js', {});

    this.preSpawn();
  }

  async init(options: Options): Promise<this> {
    const pool = (this.pool as any);
    await Promise.all(
      (pool.workers as any[])
        .map((worker, index) => worker.exec('configure', [{ ...options, seed: index === 0 }]))
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

  async findByComment(field: string, value: string, options?: FindByCommentOptions): Promise<MusicDbTrack[]> {
    return this.exec('findByComment', field, value, options);
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

  readonly settings: SettingsDb = {
    verifyLogin: async (username, password) => {
      const user = await this.exec('settings_verifyLogin', username, password);

      if (!user) {
        return;
      }

      return User.parse(user as unknown as PlainUser);
    }
  }

  dispose() {
    this.pool.terminate();
  }
}
