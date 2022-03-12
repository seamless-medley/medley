import workerpool from 'workerpool';

import type { Metadata } from '@seamless-medley/medley';
import type { BoomBoxTrack } from '../boombox';

// TODO: TTL
export class MetadataCache {
  private pool = workerpool.pool(__dirname + '/cacheWorker.js', {
    minWorkers: workerpool.cpus,
    maxWorkers: workerpool.cpus
  });

  // TODO: Use proxy

  async init() {
    const initalized = await this._isInitialized();

    if (!initalized) {
      await this._init();
    }
  }

  private async _isInitialized() {
    return this.pool.exec<() => boolean>('isInitialized', []);
  }

  private async _init() {
    await this.pool.exec('init', []);
  }

  private async _get(id: string): Promise<Metadata> {
    return this.pool.exec<MetadataCache['_get']>('get', [id]);
  }

  private async _set(id: string, data: Metadata): Promise<void> {
    await this.pool.exec<MetadataCache['_set']>('set', [id, data]);
    return;
  }

  private async _delete(id: string): Promise<void> {
    await this.pool.exec<MetadataCache['_delete']>('del', [id]);
  }

  async get(id: string, noRefresh = false) {
    await this.init();

    const metadata = await this._get(id);

    if (metadata && !noRefresh) {
      this._set(id, metadata);
    }

    return metadata;
  }

  async persist(track: BoomBoxTrack, metadata?: Metadata) {
    await this.init();

    const toBePersisted = metadata ?? track.metadata?.tags;

    if (!toBePersisted) {
      await this._delete(track.id);
      return;
    }

    await this._set(track.id, toBePersisted);
  }
}