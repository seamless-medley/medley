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
}

export class Crate<T extends Track<any>, M = never> {
  readonly id: string;
  readonly sources: TrackCollection<T, M>[];
  readonly weights: number[];
  readonly limit: number | (() => number);

  constructor(options: CrateOptions<T, M>) {
    this.id = options.id
    this.sources = options.sources.map(s => s.collection);
    this.weights = options.sources.map(s => s.weight);
    this.limit = options.limit;
  }

  private _max = 0;

  get max() {
    return this._max;
  }

  updateMax() {
    const { limit } = this;
    const result = isFunction(limit) ? limit() : limit;

    this._max = isFinite(result) ? result : sumBy(this.sources, s => s.length);
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