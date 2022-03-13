import workerpool, { WorkerPool } from 'workerpool';
import type KeyvSqlite from '@keyv/sqlite';
import type KeyvRedis from '@keyv/redis';


import type { Metadata } from '@seamless-medley/medley';
import type { BoomBoxTrack } from '../boombox';

export type MetadataCacheSqliteStore = {
  type: 'sqlite';
  path: string;
} & Omit<KeyvSqlite.Options, 'uri'>

export type MetadataCacheRedisStore = {
  type: 'redis';
} & KeyvRedis.Options;

export type MetadataCacheStore = MetadataCacheSqliteStore | MetadataCacheRedisStore;

export type MetadataCacheOptions = {
  namespace?: string;
  /**
   * TTL in milliseconds, default to 24 hours
   * @default 86400e3 (24 hours)
   */
  ttl?: number;

  store: MetadataCacheStore
}

interface Proxied {
  get(id: string): Promise<Metadata>;
  set(id: string, data: Metadata): Promise<void>;
  del(id: string): Promise<void>;
}

export class MetadataCache {
  private pool: WorkerPool;

  constructor() {
    this.pool = workerpool.pool(__dirname + '/cacheWorker.js', {

    });

    this.poolHack();
  }

  private poolHack() {
    const pool = (this.pool as any);
    const workers = pool.workers as any[];

    for (let i = 0; i < workerpool.cpus; i++) {
      const worker = pool._createWorkerHandler();
      workers.push(worker);
    }
  }

  async init(options: MetadataCacheOptions) {
    const pool = (this.pool as any);
    for (const worker of pool.workers as any[]) {
      await worker.exec('configure', [options]);
    }
  }

  private async proxied(): Promise<Proxied> {
    return (await this.pool.proxy()) as unknown as Proxied;
  }

  async get(id: string, refresh = false) {
    const proxy = await this.proxied();

    const metadata = await proxy.get(id);

    if (metadata && refresh) {
      proxy.set(id, metadata);
    }

    return metadata;
  }

  async persist(track: BoomBoxTrack, metadata?: Metadata) {
    const proxy = await this.proxied();

    const toBePersisted = metadata ?? track.metadata?.tags;

    if (!toBePersisted) {
      await proxy.del(track.id);
      return;
    }

    await proxy.set(track.id, toBePersisted);
  }
}