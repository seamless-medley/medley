import { WorkerPoolOptions } from 'workerpool';
import type { CoverAndLyrics, Metadata } from '@seamless-medley/medley';
import { Track } from '../track';
import { WorkerPoolAdapter } from '../worker_pool_adapter';
import { MusicDb } from '../library/music_db';
import { omitBy, negate } from 'lodash/fp';

let instance: MetadataHelper;

const falsy = negate(Boolean);

type WorkerCoverAndLyrics = Omit<CoverAndLyrics, 'cover'> & {
  cover: Uint8Array | {
    type: 'Buffer';
    data: number[];
  }
}

export type FetchResult = {
  hit: boolean;
  metadata: Partial<Metadata>;
}

interface Methods {
  metadata(path: string): Partial<Metadata>;
  coverAndLyrics(path: string): WorkerCoverAndLyrics | CoverAndLyrics;
  isTrackLoadable(path: string): boolean;
  searchLyrics(artist: string, title: string): string;
}

export class MetadataHelper extends WorkerPoolAdapter<Methods> {
  constructor(workerType?: WorkerPoolOptions['workerType']) {
    super(__dirname + '/worker.js', { workerType });
  }

  private ongoingTasks = new Map<string, Promise<any>>();

  private async runIfNeeded(key: string, executor: () => Promise<any>, ttl: number = 1000): Promise<any> {
    const ongoingTasks = this.ongoingTasks;

    if (ongoingTasks.has(key)) {
      return ongoingTasks.get(key) as ReturnType<typeof executor>;
    }

    const promise = new Promise((resolve, reject) => void executor()
      .then(resolve)
      .catch(reject))
      .finally(() => void setTimeout(() => ongoingTasks.delete(key), ttl));

    ongoingTasks.set(key, promise);
    return promise;
  }

  async metadata(path: string): Promise<Partial<Metadata>> {
    return this.runIfNeeded(`metadata:${path}`, async () => this.exec('metadata', path).then(omitBy(falsy)))
  }

  async coverAndLyrics(path: string): Promise<CoverAndLyrics> {
    return this.runIfNeeded(`coverAndLyrics:${path}`, async () => {
      const result = await this.exec('coverAndLyrics', path);

      if (Buffer.isBuffer(result.cover)) {
        return result as CoverAndLyrics;
      }

      return {
        ...result,
        cover: Buffer.from(isUint8Array(result.cover) ? result.cover : result.cover.data)
      }
    })
  }

  async fetchMetadata(track: Track<any>, musicDb: MusicDb | undefined, refresh = false): Promise<FetchResult> {
    if (!refresh) {
      const cached = await musicDb?.findById(track.id);
      if (cached) {
        return { hit: true, metadata: cached }
      }
    }

    const fresh = await this.metadata(track.path);
    musicDb?.update(track.id, { ...fresh, path: track.path });

    return { hit: false, metadata: fresh };
  }

  async isTrackLoadable(path: string) {
    return this.runIfNeeded(`isTrackLoadable:${path}`, async () => this.exec('isTrackLoadable', path), 500);
  }

  async searchLyrics(artist: string, title: string) {
    return this.runIfNeeded(`searchLyrics:${artist}:${title}`, async () => this.exec('searchLyrics', artist, title));
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

  static fetchMetadata(track: Track<any>, musicDb: MusicDb | undefined, refresh = false) {
    return this.getDefaultInstance().fetchMetadata(track, musicDb, refresh);
  }

  static isTrackLoadable(path: string) {
    return this.getDefaultInstance().isTrackLoadable(path);
  }

  static searchLyrics(artist: string, title: string) {
    return this.getDefaultInstance().searchLyrics(artist, title);
  }
}

const isUint8Array = (o: any): o is Uint8Array => o?.constructor === Uint8Array;
