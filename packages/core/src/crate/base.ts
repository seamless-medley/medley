import { isFunction, sumBy } from "lodash";
import { Track } from "../track";
import { createLogger, Logger, type ILogObj } from '../logging';
import { weightedSample } from "@seamless-medley/utils";

export type CrateSourceWithWeight<T extends Track<any>> = {
  collection: T['collection'];
  weight: number;
}

export interface Chanceable {
  next: () => boolean | Promise<boolean>;
  chances?: () => boolean[];
}

export type CrateLimitValue = number | 'entirely';

export type CrateLimit = CrateLimitValue | (() => CrateLimitValue);

export type CrateOptions<T extends Track<any>> = {
  id: string;
  sources: CrateSourceWithWeight<T>[];

  chance?: Chanceable;

  limit: CrateLimit;
  max?: number | (() => number);
}

export class Crate<T extends Track<any>> {
  readonly id: string;

  #sources: T['collection'][] = [];
  #sourceWeights: number[] = [];

  limit: CrateLimit;
  chance?: Chanceable;

  #max: number | (() => number);

  #logger: Logger<ILogObj>;

  constructor(options: CrateOptions<T>) {
    this.id = options.id

    this.chance = options.chance;
    this.limit = options.limit;

    this.#max = options.max ?? 0;

    this.#logger = createLogger({
      name: `crate/${this.id}`
    });

    this.updateSources(options.sources);
  }

  get sources() {
    return this.#sources;
  }

  updateSources(newSources: CrateSourceWithWeight<T>[]) {
    this.#sources = newSources.map(s => s.collection);
    this.#sourceWeights = newSources.map(s => s.weight);
  }

  get max(): number {
    return isFunction(this.#max) ? this.#max() : this.#max;
  }

  async select(force?: boolean): Promise<boolean> {
    const { chance, limit } = this;

    if (!force && chance) {
      this.#logger.debug('Select by', chance.next, 'chances', JSON.stringify(chance.chances?.()));
      const selected = await chance.next();

      if (!selected) {
        this.#logger.debug('Not selected');
        this.#max = 0;
        return false;
      }
    }

    const result = isFunction(limit) ? limit() : limit;

    this.#logger.debug('Select limit from', limit, 'as', result);

    this.#max = (result === 'entirely')
      ? () => sumBy(this.#sources, s => s.length)
      : (isFinite(result) && (result > 0) ? result : 0)
      ;

    this.#logger.debug('Limit', this.#max);

    return true;
  }

  async next(validator?: (path: string) => Promise<boolean>, intendedCollection?: T['collection']): Promise<T | undefined> {
    const source = intendedCollection ?? weightedSample(this.#sources, this.#sourceWeights);

    if (!source) {
      return;
    }

    const item = source.shift();

    if (!item) {
      return;
    }

    source.push(item);

    const isValid = validator ? await validator(item.path) : true;
    return isValid ? item as T : undefined;
  }
}
