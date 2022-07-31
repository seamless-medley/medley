import type KeyvSqlite from '@keyv/sqlite';
import type KeyvRedis from '@keyv/redis';
import type KeyvMongo from '@keyv/mongo';

import type { Metadata } from '@seamless-medley/medley';
import type { BoomBoxTrack } from '../boombox';
import { WorkerPoolAdapter } from '../../worker_pool_adapter';

export type MetadataCacheSqliteStore = {
  type: 'sqlite';
  path: string;
} & Omit<KeyvSqlite.Options, 'uri'>

export type MetadataCacheRedisStore = {
  type: 'redis';
} & KeyvRedis.Options;

export type MetadataCacheMongoStore = {
  type: 'mongo';
} & KeyvMongo.Options;

export type MetadataCacheStore = MetadataCacheSqliteStore | MetadataCacheRedisStore | MetadataCacheMongoStore;

export type MetadataCacheOptions = {
  namespace?: string;
  /**
   * TTL in milliseconds, default to 24 hours
   * @default 86400e3 (24 hours)
   */
  ttl?: number;

  store: MetadataCacheStore
}

interface Methods {
  get(id: string): Promise<Metadata>;
  set(id: string, data: Metadata): Promise<void>;
  del(id: string): Promise<void>;
}

export class MetadataCache extends WorkerPoolAdapter<Methods> {
  constructor() {
    super(__dirname + '/cache_worker.js', {});

    this.preSpawn();
  }

  async init(options: MetadataCacheOptions) {
    const pool = (this.pool as any);
    for (const worker of pool.workers as any[]) {
      await worker.exec('configure', [options]);
    }
  }

  async get(id: string, refresh = false) {
    const metadata = await this.exec('get', id);

    if (metadata && refresh) {
      this.exec('set', id, metadata);
    }

    return metadata;
  }

  async persist(track: BoomBoxTrack, metadata?: Metadata) {
    const toBePersisted = metadata ?? track.metadata?.tags;

    if (!toBePersisted) {
      await this.exec('del', track.id);
      return;
    }

    await this.exec('set', track.id, toBePersisted);
  }
}
