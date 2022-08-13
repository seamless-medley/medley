import type { Metadata } from '@seamless-medley/medley';
import { Track } from '../track';
import { BaseCache } from './base';

interface Methods {
  get(trackId: string): Promise<Metadata>;
  set(trackId: string, data: Metadata, ttl: number): Promise<void>;
  del(trackId: string): Promise<void>;
}

export class MetadataCache extends BaseCache<Methods> {
  async get(trackId: string, refresh = false) {
    const metadata = await this.exec('get', trackId);

    if (metadata && refresh) {
      this.exec('set', trackId, metadata, this.makeTTL());
    }

    return metadata;
  }

  async persist(track: Track<any>, metadata: Metadata | undefined) {
    if (!metadata) {
      await this.exec('del', track.id);
      return;
    }

    await this.exec('set', track.id, metadata, this.makeTTL());
  }
}
