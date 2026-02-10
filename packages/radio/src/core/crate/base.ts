import { isFunction, random, sample, shuffle, sortBy, stubFalse, sumBy } from "lodash";
import { Track } from "../track";
import { createLogger, type Logger } from '../../logging';
import { createNamedFunc, weightedSample } from "@seamless-medley/utils";
import { CrateProfile } from "./profile";

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
}

export type SequenceChance = 'random' | { yes: number, no: number } | (() => Promise<boolean>);

export type LimitByUpto = {
  by: 'upto';
  upto: number;
}

export type LimitByRange = {
  by: 'range';
  range: {
    min: number;
    max: number;
  }
}

export type LimitBySample = {
  by: 'sample' | 'one-of';
  list: number[];
}

export type SequenceLimit = number | 'entirely' | LimitByUpto | LimitByRange | LimitBySample;

export function crateLimitFromSequenceLimit(limit: SequenceLimit): CrateLimit  {
  if (typeof limit === 'number') {
    return limit;
  }

  if (limit === 'entirely') {
    return limit;
  }

  const { by } = limit;

  if (by === 'upto') {
    const upto = createNamedFunc(`upto:${limit.upto}`, () => random(1, limit.upto));
    return upto;
  }

  if (by === 'range') {
    const [min, max] = sortBy(limit.range);
    const range = createNamedFunc(`range:${min}_${max}`, () => random(min, max));
    return range;
  }

  if (by === 'sample' || by === 'one-of') {
    return function oneOf() { return sample(limit.list) ?? 0; }
  }

  return 0;
}

const randomChance = createNamedFunc('random', () => random() === 1);
const always = () => true;

export function createChanceable(def: SequenceChance | undefined): Chanceable {
  if (def === 'random') {
    return { next: randomChance };
  }

  if (isFunction(def)) {
    return { next: def };
  }

  if (def !== undefined) {
    return chanceOf([def.yes, def.no]);
  }

  return {
    next: always,
    chances: function always() { return [true] }
  }
}

function chanceOf(n: [yes: number, no: number]): Chanceable {
  const [yes, no] = n;

  let all = shuffle(
    Array(yes).fill(true)
      .concat(Array(no).fill(false))
  );

  let count = 0;

  return {
    next: function chanceOf() {
      const v = all.shift();
      all.push(v);

      if (count >= all.length) {
        count = 0;
        all = shuffle(all);
      }

      return v ?? false;
    },
    chances: createNamedFunc(`chanceOf:[${all}]`, () => all)
  }
}

export interface CreatePrivate<T extends Track<any>> {
  setProfile(profile: CrateProfile<T>): void;
}

export class Crate<T extends Track<any>> {
  readonly id: string;

  #profile!: CrateProfile<T>;

  #sources: T['collection'][] = [];
  #sourceWeights: number[] = [];

  limit: CrateLimit;
  chance?: Chanceable;

  #max: number | (() => number) = 0;

  #logger: Logger;

  constructor(options: CrateOptions<T>) {
    this.id = options.id

    this.chance = options.chance;
    this.limit = options.limit;

    this.#logger = createLogger({
      name: 'crate',
      id: this.id
    });

    this.updateSources(options.sources);
  }

  private setProfile(profile: CrateProfile<T>): void {
    this.#profile = profile;
  }

  get profile() {
    return this.#profile;
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
      this.#logger.debug(
        { selection: { func: chance.next.name, chances: chance.chances?.() } },
        'Select by'
      );

      const selected = await chance.next();

      if (!selected) {
        this.#logger.info('Not selected');
        this.#max = 0;
        return false;
      }

      this.#logger.info('Selected');
    }

    const result = isFunction(limit) ? limit() : limit;

    this.#logger.debug(`Select limit from ${(limit as any).name} as ${result}`);

    this.#max = (result === 'entirely')
      ? () => sumBy(this.#sources, s => s.length)
      : (isFinite(result) && (result > 0) ? result : 0)
      ;

    this.#logger.info(`Limit ${this.#max}`);

    return true;
  }

  /**
   * Select a new track from the crate
   *
   * The `intendedCollection` is not necessary to belong to the crate.
   */
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

    const isValid = validator ? await validator(item.path).catch(stubFalse) : true;

    if (!isValid) {
      this.#logger.warn('Invalid track: %s', item.path);
      return undefined;
    }

    return item as T;
  }
}
