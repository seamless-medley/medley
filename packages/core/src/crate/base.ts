import { isFunction, sumBy } from "lodash";
import { TrackCollection } from "../collections/base";
import { Track } from "../track";
import { createLogger, Logger, type ILogObj } from '../logging';
import { weightedSample } from "@seamless-medley/utils";

export type CrateSourceWithWeight<T extends Track<any, E>, E = any> = {
  collection: TrackCollection<T, E>;
  weight: number;
}

export interface Chanceable {
  next: () => boolean | Promise<boolean>;
  chances?: () => boolean[];
}

export type CrateLimitValue = number | 'all';

export type CrateLimit = CrateLimitValue | (() => CrateLimitValue);

export type CrateOptions<T extends Track<any, E>, E = any> = {
  id: string;
  sources: CrateSourceWithWeight<T, E>[];

  chance?: Chanceable;

  limit: CrateLimit;
  max?: number;
}

export class Crate<T extends Track<any, CE>, CE = any> {
  readonly id: string;

  private _sources: TrackCollection<T, CE>[] = [];
  private sourceWeights: number[] = [];

  limit: CrateLimit;
  chance?: Chanceable;

  private _max: number;

  protected logger: Logger<ILogObj>;

  constructor(options: CrateOptions<T, CE>) {
    this.id = options.id

    this.chance = options.chance;
    this.limit = options.limit;

    this._max = options.max ?? 0;

    this.logger = createLogger({
      name: `crate/${this.id}`
    });

    this.updateSources(options.sources);
  }

  get sources() {
    return this._sources;
  }

  updateSources(newSources: CrateSourceWithWeight<T, CE>[]) {
    this._sources = newSources.map(s => s.collection);
    this.sourceWeights = newSources.map(s => s.weight);
  }

  get max() {
    return this._max;
  }

  async select(force?: boolean): Promise<boolean> {
    const { chance, limit } = this;

    if (!force && chance) {
      this.logger.debug('Select by', chance.next, 'chances', JSON.stringify(chance.chances?.()));
      const selected = await chance.next();

      if (!selected) {
        this.logger.debug('Not selected');
        this._max = 0;
        return false;
      }
    }

    const result = isFunction(limit) ? limit() : limit;

    this.logger.debug('Select limit from', limit, 'as', result);

    this._max = (result === 'all')
      ? sumBy(this._sources, s => s.length)
      : (isFinite(result) && (result > 0) ? result : 0)
      ;

    this.logger.debug('Limit', this._max);

    return true;
  }

  async next(validator?: (path: string) => Promise<boolean>, intendedCollection?: TrackCollection<T, CE>): Promise<T | undefined> {
    const source = intendedCollection ?? weightedSample(this._sources, this.sourceWeights);

    if (!source) {
      return;
    }

    const item = source.shift();

    if (!item) {
      return;
    }

    source.push(item);

    const isValid = validator ? await validator(item.path) : true;
    return isValid ? item : undefined;
  }
}
