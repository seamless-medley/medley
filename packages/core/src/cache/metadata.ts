import type { Metadata } from '@seamless-medley/medley';
import { MusicIdendifier } from '../track';
import { BaseCache } from './base';

// TODO: Use real database (MikroORM maybe? or just use MongoDB?)

interface Methods {
  get(musicId: string): Promise<Metadata | undefined>;
  set(musicId: string, data: Metadata, ttl: number): Promise<void>;
  del(musicId: string): Promise<void>;
}
export class MetadataCache extends BaseCache<Methods> {
  async get(musicId: string, refresh = false) {
    const metadata = await this.exec('get', musicId);

    if (metadata && refresh) {
      this.set(musicId, metadata);
    }

    return metadata;
  }

  async set(musicId: string, metadata: Metadata) {
    return this.exec('set', musicId, metadata, this.makeTTL());
  }

  async del(musicId: string) {
    return this.exec('del', musicId);
  }

  async persist({ id, musicId }: MusicIdendifier, metadata: Metadata | undefined) {
    if (!metadata) {
      this.del(id);

      if (musicId) {
        this.del(musicId);
      }

      return;
    }

    await this.set(id, metadata);
    if (musicId) {
      await this.set(musicId, metadata);
    }
  }
}
