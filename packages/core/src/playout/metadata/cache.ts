import workerpool, { WorkerPool } from 'workerpool';

import type { Metadata } from '@seamless-medley/medley';
import type { BoomBoxTrack } from '../boombox';

interface Proxied {
  isInitialized(): Promise<boolean>;
  init(): Promise<void>;
  get(id: string): Promise<Metadata>;
  set(id: string, data: Metadata): Promise<void>;
  del(id: string): Promise<void>;
}

// TODO: TTL
export class MetadataCache {

  private pool: WorkerPool;

  // TODO: Configuration
  constructor() {
    this.pool = workerpool.pool(__dirname + '/cacheWorker.js', {

    });
  }

  async init() {
    await this.proxied();
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