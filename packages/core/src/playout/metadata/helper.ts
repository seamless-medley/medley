import workerpool, { WorkerPool, WorkerPoolOptions } from 'workerpool';
import type { CoverAndLyrics, Metadata } from '@seamless-medley/medley';
import { MetadataCache } from './cache';
import { Track } from '../../track';

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

export class MetadataHelper {
  private pool: WorkerPool;

  constructor(workerType?: WorkerPoolOptions['workerType']) {
    this.pool = workerpool.pool(__dirname + '/metadata_worker.js', { workerType });
  }

  async metadata(path: string) {
    return this.pool.exec<Methods['metadata']>('metadata', [path]);
  }

  async coverAndLyrics(path: string): Promise<CoverAndLyrics> {
    const result = await this.pool.exec<Methods['coverAndLyrics']>('coverAndLyrics', [path]);

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
    return this.pool.exec<Methods['isTrackLoadable']>('isTrackLoadable', [path]);
  }

  async searchLyrics(artist: string, title: string) {
    return this.pool.exec<Methods['searchLyrics']>('searchLyrics', [artist, title]);
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