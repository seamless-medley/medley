import { MusicDb, MusicTrack } from "@seamless-medley/core";
import { WorkerPoolAdapter } from "@seamless-medley/core/src/worker_pool_adapter";
import { random } from "lodash";
import { Collection, Db, MongoClient } from "mongodb";

// TODO: Make use of worker

type ExpiryMusicTrack = MusicTrack & { expires: number };

export type Options = {
  url: string;

  database: string;

  /**
   * TTL in seconds, default to 24,36 hours
   * @default [86400,129600]  (24,36 hours)
   */
   ttls?: [min: number, max: number];
}

export class MongoMusicDb extends WorkerPoolAdapter<MusicDb> implements MusicDb {
  constructor(private options: Options) {
    super(__dirname + '/worker.js', {});

    this.preSpawn();
  }

  async init() {
    const pool = (this.pool as any);
    for (const worker of pool.workers as any[]) {
      await worker.exec('configure', [this.options]);
    }
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
}
