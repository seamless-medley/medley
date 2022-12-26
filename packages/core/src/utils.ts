import { clamp, random, sample, subtract, sum, uniq } from "lodash";
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

export const waitFor = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const breath = () => waitFor(0);

export const nextTick = () => new Promise<void>(resolve => process.nextTick(resolve));

export const delayed = <T extends () => any, R = ReturnType<T>>(fn: T, wait: number): () => Promise<Awaited<R>> => () => waitFor(wait).then(fn);

export function moveArrayIndexes<T>(list: Array<T>, newPosition: number, ...indexes: number[]): typeof list {
  indexes = uniq(indexes.filter(inRange(0, list.length)));
  newPosition = clamp(newPosition, 0, list.length - indexes.length);

  const values = indexes.map(i => list[i]);
  for (const index of indexes) {
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
} | {
  wait?: undefined;
  factor: number;
  maxWait: number;
}

export type RetryOptions = {
  retries?: number;
  signal?: AbortSignal;
} & WaitOption;

export function retryable<R>(fn: () => Promise<R>, options: RetryOptions) {
  let attempts = 0;

  async function wrapper(n?: number): Promise<R | undefined> {
    try {
      if (options.signal?.aborted) {
        return;
      }

      return await fn();
    } catch (e) {
      if (n !== undefined && n <= 0) {
        throw e;
      }

      const wait = options.wait ?? Math.min(options.maxWait, Math.pow(options.factor, ++attempts));

      return delayed(() => wrapper(n !== undefined ? n - 1 : n), wait)();
    }
  }

  return new Promise<R | undefined>((resolve, reject) => {
    wrapper(options.retries).then(resolve).catch(reject)
  });
}
