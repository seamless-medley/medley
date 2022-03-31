import { isFunction, sumBy } from "lodash";
import { weightedSample } from "../utils";
import { TrackCollection } from "../collections/base";
import { Track } from "../track";

export type CrateSourceWithWeight<T extends Track<any>, M = never> = {
  collection: TrackCollection<T, M>;
  weight: number;
}

export interface Chanceable {
  next: () => boolean | Promise<boolean>;
  chances?: () => boolean[];
}

export type CrateLimitValue = number | 'all';

export type CrateLimit = CrateLimitValue | (() => CrateLimitValue);

export type CrateOptions<T extends Track<any>, M = never> = {
  id: string;
  sources: CrateSourceWithWeight<T, M>[];

  chance?: Chanceable;

  limit: CrateLimit;
  max?: number;
}

export class Crate<T extends Track<any>, M = never> {
  readonly id: string;

  private _sources: TrackCollection<T, M>[] = [];
  private sourceWeights: number[] = [];

  limit: CrateLimit;
  chance?: Chanceable;

  private _max: number;

  constructor(options: CrateOptions<T, M>) {
    this.id = options.id

    this.chance = options.chance;
    this.limit = options.limit;

    this._max = options.max ?? 0;
    this.updateSources(options.sources);
  }

  get sources() {
    return this._sources;
  }

  updateSources(newSources: CrateSourceWithWeight<T, M>[]) {
    this._sources = newSources.map(s => s.collection);
    this.sourceWeights = newSources.map(s => s.weight);
  }

  get max() {
    return this._max;
  }

  async select(): Promise<boolean> {
    const { chance, limit } = this;

    if (chance) {
      const selected = await chance.next();
      if (!selected) {
        return false;
      }
    }
    const result = isFunction(limit) ? limit() : limit;

    this._max = (result === 'all')
      ? sumBy(this._sources, s => s.length)
      : (isFinite(result) && (result > 0) ? result : 0)
      ;

    return true;
  }

  async next(validator?: (path: string) => Promise<boolean>): Promise<T | undefined> {
    const source = weightedSample(this._sources, this.sourceWeights);

    if (!source) {
      return;
    }

    const item = source.shift();
    const isValid = (item && validator) ? await validator(item.path) : true;

    if (!isValid || !item) {
      return undefined;
    }

    source.push(item);
    return item;
  }
}