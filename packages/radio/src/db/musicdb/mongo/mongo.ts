import { noop } from "lodash";
import { createLogger, type Logger } from "../../../logging";
import { Db, MongoClient, type MongoClientOptions } from "mongodb";

import { SettingsDb } from "../../types";
import { FindByCommentOptions, MusicDb, MusicDbTrack, SearchHistory, TrackHistory, WorkerPoolAdapter } from "../../../core";
import { User } from "../../persistent/user";
import { PlainUser } from "../../../remotes/types";

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
  #logger: Logger;

  #options: Options | undefined;

  #localClient: MongoClient | undefined;
  #localClientRefCount = 0;

  constructor() {
    super(__dirname + '/worker.js', {});

    this.#logger = createLogger({
      name: 'musicdb:mongo',
      id: `main`
    });

    this.#logger.debug('Pre-spawn');
    this.preSpawn();
  }

  async init(options: Options): Promise<this> {

    if (!this.#options) {
      const pool = (this.pool as any);

      this.#logger.debug('Configure workers');

      await Promise.all(
        (pool.workers as any[])
          .map((worker, index) => worker.exec('configure', [{ ...options, seed: index === 0 }]))
      );

      this.#options = options;
    }

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

  async #withLocalClient<T>(fn: (client: MongoClient, db: Db) => Promise<T>): Promise<T | undefined> {
    if (!this.#options) {
      return;
    }

    if (!this.#localClient) {
      this.#localClient = new MongoClient(this.#options.url, {
        serverSelectionTimeoutMS: 5000,
        ...this.#options.connectionOptions
      });
    }

    this.#localClientRefCount++;
    const db = this.#localClient.db(this.#options.database);
    await fn(this.#localClient, db).catch(noop);
    this.#localClientRefCount--;

    if (this.#localClientRefCount <= 0) {
      this.#localClient = undefined;
      this.#localClientRefCount = 0;
    }
  }

  async validateTracks(predicate: (trackId: string) => Promise<boolean>): ReturnType<MusicDb['validateTracks']> {
    // This could not be done using worker, simply connect to the mongodb instance directly

    type ResultType = Awaited<ReturnType<MusicDb['validateTracks']>>;

    if (!this.#options) {
      return [0, 0] as ResultType;
    }

    const promise = this.#withLocalClient(async (client, db) => {
      const musics = db.collection('musics');

      const documentCountBeforeDeletion = await musics.countDocuments();

      let totalDeleted = 0;
      let marked: string[] = [];

      const doBatchDelete = async (force?: boolean) => {
        if (force || marked.length >= 1000) {
          this.#logger.debug(`Compact: removing ${marked.length} records`);
          const { deletedCount } = await musics.deleteMany({ trackId: { $in: marked } });
          this.#logger.debug(`Compact: removed ${deletedCount} records`);
          marked = [];
          return deletedCount;
        }

        return 0;
      }

      const collect = async (trackId: string) => {
        marked.push(trackId);
        totalDeleted += await doBatchDelete();
      }

      const cursor = musics.find().project({ trackId: 1 });
      for await (const { trackId } of cursor) {
        const valid = await predicate(trackId);
        if (!valid) {
          await collect(trackId)
        }
      }

      totalDeleted += await doBatchDelete(true);

      return [documentCountBeforeDeletion - totalDeleted, totalDeleted] as ResultType;
    });

    return (await promise) ?? [0, 0] as ResultType;
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
