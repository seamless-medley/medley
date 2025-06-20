import { castArray, clamp, random, sample, sortBy, subtract, sum, trim, uniq } from "lodash";
import { inRange } from 'lodash/fp';

export const decibelsToGain = (decibels: number): number => decibels > -100 ? Math.pow(10, decibels * 0.05) : 0;

export const gainToDecibels = (gain: number): number => gain > 0 ? Math.max(-100, Math.log10(gain) * 20) : -100;

export function weightedSample<T>(list: T[], weights: number[]) {
  if (list.length > 1 && list.length === weights.length) {
    const summedWeight = sum(weights);
    if (summedWeight > 0) {
      const selected = random(true) * summedWeight;

      let total = 0;
      let selectedIndex: number | undefined;
      let lastIndex: number | undefined = undefined;

      for (const [index, weight] of weights.entries()) {
        total += weight;

        if (weight > 0) {
          if (selected <= total) {
            selectedIndex = index;
            break;
          }
          lastIndex = index;
        }

        if (index === weights.length - 1) {
          selectedIndex = lastIndex;
        }
      }

      if (selectedIndex !== undefined) {
        return list[selectedIndex];
      }
    }
  }

  return sample(list);
}

export const waitFor = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const handleAbort = () => {
    clearTimeout(timer);
    reject(new Error('Aborted'));
  }

  signal?.addEventListener('abort', handleAbort);

  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, ms);
});

export const breath = () => waitFor(0);

export const nextTick = () => new Promise<void>(resolve => process.nextTick(resolve));

export const delayed = <T extends () => any, R = ReturnType<T>>(fn: T, wait: number): () => Promise<Awaited<R>> => () => waitFor(wait).then(fn);

export function moveArrayIndexes<T>(list: Array<T>, newPosition: number, ...indexes: number[]): typeof list {
  indexes = uniq(indexes.filter(inRange(0, list.length)));
  newPosition = clamp(newPosition, 0, list.length - indexes.length);

  const values = indexes.map(i => list[i]);
  for (const index of sortBy(indexes, i => -i)) {
    list.splice(index, 1);
  }

  list.splice(newPosition, 0, ...values);
  return list;
}

export function moveArrayElementsWithValidator<T>(list: Array<T>, newPosition: number, validator: (v: T) => boolean, ...values: Array<T>): typeof list {
  values = uniq(values).filter(v => v && validator(v) === true);
  newPosition = clamp(newPosition, 0, list.length - values.length);

  for (const v of values) {
    list.splice(list.indexOf(v), 1);
  }

  list.splice(newPosition, 0, ...values);
  return list;
}

export function moveArrayElements<T>(list: Array<T>, newPosition: number, ...values: Array<T>): typeof list {
  const set = new Set(list);
  moveArrayElementsWithValidator(list, newPosition, v => set.has(v), ...values);
  return list;
}

export function numbersToRanges(...numbers: number[]): [start: number, end: number][] {
  const result: [start: number, end: number][] = [];

  numbers = numbers.sort(subtract);

  let prev = undefined;
  let pair: [start: number, end: number] | undefined = undefined;

  for (const n of numbers) {
    if (prev && (n - prev > 1)) {
      pair = undefined;
    }

    if (pair === undefined) {
      pair = [n, 0];
      result.push(pair);
    }

    pair[1] = n + 1;

    prev = n;
  }

  return result;
}

export function interpolate(sourceValue: number, sourceRange: [min: number, max: number], targetRange: [min: number, max: number]) {
  const [sourceMin, sourceMax] = sourceRange;
  const [targetMin, targetMax] = targetRange;

  const sourceLength = (sourceMax - sourceMin);
  const targetLength = (targetMax - targetMin);
  const progress = (sourceValue - sourceMin);


  return targetMin + (targetLength * progress / sourceLength);
}

type WaitOption = {
  wait: number;
  /**
   * @default 1.01
   */
  factor?: number;
  maxWait?: number;
}

export type RetryOptions = {
  retries?: number;
  signal?: AbortSignal;
  onError?: (err: any, attempts: number) => any;
} & WaitOption;

export type RetryInfo = {
  attempts: number;
  previousError: unknown;
}

export class AbortRetryError extends Error {

}

export function retryable<R>(fn: (info: RetryInfo) => Promise<R>, options: RetryOptions) {
  let attempts = 0;
  let previousError: unknown;

  async function wrapper(n?: number): Promise<R | undefined> {
    try {
      if (options.signal?.aborted) {
        return;
      }

      return await fn({ attempts, previousError });
    } catch (e) {
      if (e instanceof AbortRetryError) {
        return;
      }

      if (n !== undefined && n <= 0) {
        throw e;
      }

      previousError = e;
      ++attempts;

      options?.onError?.(e, attempts);

      const wait = Math.min(
        options.maxWait ?? options.wait,
        options.wait * Math.pow(options.factor ?? 1.01, attempts)
      );

      return delayed(() => wrapper(n !== undefined ? n - 1 : n), wait)();
    }
  }

  return new Promise<R | undefined>((resolve, reject) => {
    wrapper(options.retries).then(resolve).catch(reject)
  });
}

export function concatUint8Array(...items: Uint8Array[]): Uint8Array {
  const size = items.reduce((size, a) => size + a.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const item of items) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}

export const makeUint8ArrayFromText = (s: string) => Uint8Array.from(s.split('').map(c => c.charCodeAt(0)));

export const randomNBit = (numberOfBits: number) => Math.floor(Math.random() * 2 ** numberOfBits);

export function createNamedFunc<F extends (...args: any) => any>(name: string, fn: F): F {
  const f = ({ [name]: function() { return fn.apply(this, arguments as any) } })[name] as F;
  return f;
}

export async function groupByAsync<T, K extends string>(items: T[], getKey: (o: T) => Promise<K>) {
  const mapped = await Promise.all(items.map(async item => ({
    key: await getKey(item),
    item
  })));

  return mapped.reduce((o, { key, item }) => {
    if (!(key in o)) {
      o[key] = [];
    }

    o[key].push(item);

    return o;
  }, {} as Record<K, T[]>)
}

export function formatDuration(seconds: number, options?: { withMs?: boolean }) {
  if (seconds <= 0) {
    return;
  }

  const parts = [
    [1/(60 * 60), 24, true], // hours
    [1/60, 60], // minutes
    [1, 60], // seconds
    [100, 100]
  ] as Array<[multiplier: number, modulus: number, optional: boolean | undefined]>;

  const [h, m, s, ms] = parts
    .map(([mul, mod, optional]) => {
      const v = Math.trunc(seconds * mul) % mod;
      return (v !== 0 || !optional) ? `${v}`.padStart(2, '0') : undefined;
    })

  const result = [h, m, s].filter(v => v !== undefined).join(':');

  return options?.withMs ? `${result}.${ms}` : result;
}

export type TrackBannerOptions = {
  separators?: Partial<Record<'title' | 'artist', string>>;
}

export type SongBannerFormatOptions = {
  title?: string;
  artists?: string[] | string;
} & TrackBannerOptions;

export function formatSongBanner(options: SongBannerFormatOptions): string | undefined {
  const { title, artists, separators } = options;
  const info: string[] = [];

  if (artists) {
    info.push(castArray(artists).join(separators?.artist ?? ','));
  }

  if (title) {
    info.push(title);
  }

  return info.length ? info.join(separators?.title ?? ' - ') : undefined;
}

export const extractArtists = (artists: string) => uniq(artists.split(/[/;,]/)).map(trim);

export const formatTags = (tags: { title?: string; artist?: string }) => formatSongBanner({
  title: tags.title,
  artists: tags.artist ? extractArtists(tags.artist) : undefined,
  separators: {
    artist: '/'
  }
})
