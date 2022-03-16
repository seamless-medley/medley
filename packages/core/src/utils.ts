import { random, sample, shuffle, sortBy, sum } from "lodash";

export const decibelsToGain = (decibels: number): number => decibels > -100 ? Math.pow(10, decibels * 0.05) : 0;

export const gainToDecibels = (gain: number): number => gain > 0 ? Math.max(-100, Math.log10(gain) * 20) : -100;

export function weightedSample<T>(list: T[], weights: number[]) {
  if (list.length === weights.length) {
    const summedWeight = sum(weights);
    if (summedWeight > 0) {
      const selected = random(true) * summedWeight;

      let total = 0;
      let selectedIndex: number | undefined;
      let lastIndex: number | undefined = undefined;

      for (let [index, weight] of weights.entries()) {
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

export class Chance {
  private all: boolean[];

  private index: number = 0;

  constructor(n: [n: number, denum: number]) {
    const [ones, total] = sortBy(n);
    this.all = shuffle(Array(total - ones).fill(false).concat(Array(ones).fill(true)));
  }

  next() {
    const v = this.all[this.index++];

    if (this.index >= this.all.length) {
      this.index = 0;
      this.all = shuffle(this.all);
    }

    return v;
  }
}
