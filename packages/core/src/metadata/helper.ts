import { WorkerPoolOptions } from 'workerpool';
import type { CoverAndLyrics, Metadata } from '@seamless-medley/medley';
import { MetadataCache } from './cache';
import { Track } from '../track';
import { WorkerPoolAdapter } from '../worker_pool_adapter';

let instance: MetadataHelper;

type WorkerCoverAndLyrics = Omit<CoverAndLyrics, 'cover'> & {
  cover: Uint8Array | {
    type: 'Buffer';
    data: number[];
  }
}

export type FetchResult = {
  hit: boolean;
  metadata: Metadata;
}

interface Methods {
  metadata(path: string): Promise<Metadata>;
  coverAndLyrics(path: string): Promise<WorkerCoverAndLyrics | CoverAndLyrics>;
  isTrackLoadable(path: string): Promise<boolean>;
  searchLyrics(artist: string, title: string): Promise<string>;
}

export class MetadataHelper extends WorkerPoolAdapter<Methods> {
  constructor(workerType?: WorkerPoolOptions['workerType']) {
    super(__dirname + '/metadata_worker.js', { workerType });
  }

  async metadata(path: string) {
    return this.exec('metadata', path);
  }

  async coverAndLyrics(path: string): Promise<CoverAndLyrics> {
    const result = await this.exec('coverAndLyrics', path);

    if (Buffer.isBuffer(result.cover)) {
      return result as CoverAndLyrics;
    }

    return {
      ...result,
      cover: Buffer.from(isUint8Array(result.cover) ? result.cover : result.cover.data)
    }
  }

  async fetchMetadata(track: Track<any>, cache: MetadataCache | undefined, refresh = false): Promise<FetchResult> {
    const cached = await cache?.get(track.id, refresh);
    if (cached) {
      return { hit: true, metadata: cached };
    }

    const fresh = await this.metadata(track.path);
    cache?.persist(track, fresh);

    return { hit: false, metadata: fresh };
  }

  async isTrackLoadable(path: string) {
    return this.exec('isTrackLoadable', path);
  }

  async searchLyrics(artist: string, title: string) {
    return this.exec('searchLyrics', artist, title);
  }

  static getDefaultInstance() {
    if (!instance) {
      instance = new MetadataHelper();
    }

    return instance;
  }

  static metadata(path: string) {
    return this.getDefaultInstance().metadata(path);
  }

  static coverAndLyrics(path: string) {
    return this.getDefaultInstance().coverAndLyrics(path);
  }

  static fetchMetadata(track: Track<any>, cache: MetadataCache | undefined, refresh = false) {
    return this.getDefaultInstance().fetchMetadata(track, cache, refresh);
  }

  static isTrackLoadable(path: string) {
    return this.getDefaultInstance().isTrackLoadable(path);
  }

  static searchLyrics(artist: string, title: string) {
    return this.getDefaultInstance().searchLyrics(artist, title);
  }
}

const isUint8Array = (o: any): o is Uint8Array => o?.constructor === Uint8Array;
