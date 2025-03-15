import { WorkerPoolOptions } from 'workerpool';
import type { AudioProperties, CoverAndLyrics, Metadata } from '@seamless-medley/medley';
import { Track } from '../track';
import { WorkerPoolAdapter } from '../worker_pool_adapter';
import { MusicDb } from '../library/music_db';
import { omitBy, negate } from 'lodash/fp';
import { BoomBoxCoverAnyLyrics } from '../playout';
import { isEqual, omit, stubFalse } from 'lodash';
import { LyricProviderName, LyricsSearchResult } from './lyrics/types';

let instance: MetadataHelper;
import { cachedWith } from '@seamless-medley/utils';

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
  timestamp?: number;
  modified?: boolean;
}

interface Methods {
  metadata(path: string): Metadata | undefined;
  audioProperties(path: string): AudioProperties;
  coverAndLyrics(path: string): WorkerCoverAndLyrics | BoomBoxCoverAnyLyrics;
  isTrackLoadable(path: string): boolean;
  searchLyrics(artist: string, title: string, provider: LyricProviderName): LyricsSearchResult | undefined;
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
      let timer: NodeJS.Timeout;

      if (timeout) {
        const cause = new Error();

        timer = setTimeout(() => {
          reject(new TaskTimeoutError(cause));
        }, timeout);
      }

      executor()
        .then(resolve)
        .catch(reject)
        .finally(() => timer && clearTimeout(timer))
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

  async audioProperties(path: string) {
    return this.#runIfNeeded(
      `audioProperties:${path}`,
      async () => this.exec('audioProperties', path)
    );
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
    const cached = await musicDb?.findById(track.id);
    const metadata = omit(cached, 'trackId', 'timestamp');

    if (!refresh) {
      if (cached) {
        return {
          hit: true,
          timestamp: cached.timestamp,
          metadata
        }
      }
    }

    const fresh = await this.metadata(track.path);
    fresh.comments = fresh.comments?.filter(([key]) => /^[^:]+:(?!\/\/)/i.test(key)) ?? [];

    const updated = await musicDb?.update(track.id, { ...fresh, path: track.path });

    return {
      hit: false,
      timestamp: updated?.timestamp,
      modified: refresh ? !isEqual(metadata, fresh) : false,
      metadata: fresh
    };
  }

  async isTrackLoadable(path: string, timeout = 500) {
    return this.#runIfNeeded(
      `isTrackLoadable:${path}`,
      async () => this.exec('isTrackLoadable', path),
      { ttl: 500, timeout }
    )
    .catch(stubFalse);
  }

  async searchLyrics(artist: string, title: string, provider: LyricProviderName) {
    return this.#runIfNeeded(`searchLyrics:${artist}:${title}`, async () => this.exec('searchLyrics', artist, title, provider));
  }

  static #cache = cachedWith(async () => new MetadataHelper());

  static async for<R>(domain: string, fn: (helper: MetadataHelper) => R): Promise<Awaited<R>> {
    return await this.#cache(domain).then(fn)
  }
}

const isUint8Array = (o: any): o is Uint8Array => o?.constructor === Uint8Array;
