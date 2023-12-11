import { WorkerPoolOptions } from 'workerpool';
import type { CoverAndLyrics, Metadata } from '@seamless-medley/medley';
import { Track } from '../track';
import { WorkerPoolAdapter } from '../worker_pool_adapter';
import { MusicDb } from '../library/music_db';
import { omitBy, negate } from 'lodash/fp';
import { BoomBoxCoverAnyLyrics } from '../playout';
import { stubFalse } from 'lodash';

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
  metadata: Metadata;
}

interface Methods {
  metadata(path: string): Metadata | undefined;
  coverAndLyrics(path: string): WorkerCoverAndLyrics | BoomBoxCoverAnyLyrics;
  isTrackLoadable(path: string): boolean;
  searchLyrics(artist: string, title: string): { lyrics: string[], source: BoomBoxCoverAnyLyrics['lyricsSource'] } | undefined;
}

type RunIfNeededOptions = {
  ttl?: number;
  timeout?: number;
}

class TaskTimeoutError extends Error {
  constructor(cause: Error) {
    super('Task timed out');
    this.cause = cause;
  }
}

export class MetadataHelper extends WorkerPoolAdapter<Methods> {
  constructor(workerType?: WorkerPoolOptions['workerType']) {
    super(__dirname + '/worker.js', { workerType });
  }

  #ongoingTasks = new Map<string, Promise<any>>();

  async #runIfNeeded<E extends () => Promise<any>, R = E extends () => Promise<infer R> ? R : unknown>(
    key: string,
    executor: E,
    { ttl = 1000, timeout }: RunIfNeededOptions = {}
  ): Promise<R>
  {
    const ongoingTasks = this.#ongoingTasks;

    if (ongoingTasks.has(key)) {
      return ongoingTasks.get(key) as Promise<R>;
    }

    const promise = new Promise<R>(async (resolve, reject) => {
      if (timeout) {
        const cause = new Error();
        setTimeout(() => reject(new TaskTimeoutError(cause)), timeout);
      }

      executor().then(resolve).catch(reject);
    });

    const removeOnGoing = () => void setTimeout(() => ongoingTasks.delete(key), ttl);
    ongoingTasks.set(key, promise);
    return promise.finally(removeOnGoing);
  }

  async metadata(path: string) {
    const m = await this.#runIfNeeded(
      `metadata:${path}`,
      async () => this.exec('metadata', path).then(omitBy(falsy))
    );
    return (m ?? {}) as Metadata;
  }

  async coverAndLyrics(path: string) {
    return this.#runIfNeeded(`coverAndLyrics:${path}`, async () => {
      const lyricsSource = { text: 'Metadata' };

      const result = await this.exec('coverAndLyrics', path);

      if (Buffer.isBuffer(result.cover)) {
        return {
          ...result,
          lyricsSource
        } as BoomBoxCoverAnyLyrics
      }

      return {
        ...result,
        lyricsSource,
        cover: Buffer.from(isUint8Array(result.cover) ? result.cover : result.cover.data)
      } as BoomBoxCoverAnyLyrics
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
    fresh.comments = fresh.comments?.filter(([key]) => /^[^:]+:(?!\/\/)/i.test(key)) ?? []; //

    musicDb?.update(track.id, { ...fresh, path: track.path });

    return { hit: false, metadata: fresh };
  }

  async isTrackLoadable(path: string, timeout = 500) {
    return this.#runIfNeeded(
      `isTrackLoadable:${path}`,
      async () => this.exec('isTrackLoadable', path),
      { ttl: 500, timeout }
    )
    .catch(stubFalse);
  }

  async searchLyrics(artist: string, title: string) {
    return this.#runIfNeeded(`searchLyrics:${artist}:${title}`, async () => this.exec('searchLyrics', artist, title));
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

  static isTrackLoadable(path: string, timeout?: number) {
    return this.getDefaultInstance().isTrackLoadable(path, timeout);
  }

  static searchLyrics(artist: string, title: string) {
    return this.getDefaultInstance().searchLyrics(artist, title);
  }
}

const isUint8Array = (o: any): o is Uint8Array => o?.constructor === Uint8Array;
