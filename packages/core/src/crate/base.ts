import { isFunction, sumBy } from "lodash";
import { weightedSample } from "..";
import { TrackCollection } from "../collections/base";
import { Track } from "../track";

export type CrateSourceWithWeight<T extends Track<any>, M = never> = {
  collection: TrackCollection<T, M>;
  weight: number;
}

export type CrateOptions<T extends Track<any>, M = never> = {
  id: string;
  sources: CrateSourceWithWeight<T, M>[];
  limit: number | (() => number);
  max?: number;
}

const isNotInfinity = (n: number) => (n !== Number.POSITIVE_INFINITY) && (n !== Number.NEGATIVE_INFINITY);

export class Crate<T extends Track<any>, M = never> {
  readonly id: string;
  readonly sources: TrackCollection<T, M>[];
  readonly weights: number[];
  readonly limit: number | (() => number);

  private _max: number;

  constructor(options: CrateOptions<T, M>) {
    this.id = options.id
    this.sources = options.sources.map(s => s.collection);
    this.weights = options.sources.map(s => s.weight);
    this.limit = options.limit;
    this._max = options.max ?? 0;
  }

  get max() {
    return this._max;
  }

  updateMax() {
    const { limit } = this;
    const result = isFunction(limit) ? limit() : limit;

    this._max = isNotInfinity(result) ? (result || 0)  : sumBy(this.sources, s => s.length);
  }

  async next(validator?: (path: string) => Promise<boolean>): Promise<T | undefined> {
    const source = weightedSample(this.sources, this.weights);

    if (!source) {
      return;
    }

    const item = source.shift();

    const isValid = item && validator ? await validator(item.path) : true;

    if (isValid && item) {
      source.push(item);
    }

    return item;
  }
}