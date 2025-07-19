import { clamp, random, sample, sortBy, sum, uniq } from "lodash";
import { inRange } from 'lodash/fp';

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
