import { curry, sample, sortBy } from "lodash";
import { TrackCollection } from "../collections";
import { createLogger, Logger } from "../logging";
import { BoomBox, BoomBoxEvents, BoomBoxTrack, TrackKind } from "./boombox";

export type SweeperInsertionRule = {
  from?: string[];
  to?: string[];
  collection: TrackCollection<BoomBoxTrack>;
}

const validateRule = (from: [id: string, list: string[] | undefined], to: [id: string, list: string[] | undefined]): boolean => {
  const [actualTo, toList] = to;

  const [actualFrom, fromList] = from;

  if (fromList && !toList) {
    // from list -> any
    return fromList.includes(actualFrom) && !fromList.includes(actualTo);
  }

  if (!fromList && toList) {
    // any -> to list
    return toList.includes(actualTo) && !toList.includes(actualFrom);
  }

  if (fromList && toList) {
    // from list -> to list
    return (fromList.includes(actualFrom) && toList.includes(actualTo))
        && (!fromList.includes(actualTo) && !toList.includes(actualFrom));
  }

  return false;
}

const matchRule = curry((from: string, to: string, rule: SweeperInsertionRule) => validateRule(
    [from, rule.from],
    [to, rule.to]
  )
);

const sortOrder = ({ from, to }: SweeperInsertionRule) => {
  if (from && to) {
    return 0;
  }

  if (from && !to) {
    return 1;
  }

  if (!from && to) {
    return 2;
  }

  return 3;
}

export const findRule = (from: string, to: string, rules: SweeperInsertionRule[], ignoreFrom: boolean) => {
  const sorted = sortBy(rules, sortOrder);

  if (ignoreFrom) {
    const matches = sorted.filter(rule => rule.to?.includes(to));
    return sample(matches);
  }

  return sorted.find(matchRule(from, to));
}

export class SweeperInserter {
  constructor(private boombox: BoomBox, public rules: SweeperInsertionRule[] = []) {
    boombox.on('currentCollectionChange', this.handler);
  }

  private static _logger?: Logger;

  get logger() {
    return SweeperInserter._logger = SweeperInserter._logger ?? createLogger({ name: 'sweeper-inserter' });
  }

  private recent: string[] = [];

  private pick(collection: TrackCollection<BoomBoxTrack>) {
    const count = this.recent.length + 1;

    for (let i = 0; i < count; i++) {
      for (let j = 0; j < collection.length; j++) {
        const track = collection.shift();

        if (track) {
          collection.push(track);

          if (!this.recent.includes(track.id)) {
            this.recent.push(track.id);
            return track;
          }
        }
      }

      this.recent.shift();
    }

    return collection.sample();
  }

  private handler: BoomBoxEvents['currentCollectionChange'] = (oldCollection, newCollection, ignoreFrom) => {
    const matched = findRule(oldCollection.id, newCollection.id, this.rules, ignoreFrom);

    if (!matched) {
      return;
    }

    const insertion = this.pick(matched.collection);
    if (insertion) {
      // ensure track kind
      if (insertion.extra?.kind === undefined) {
        insertion.extra = {
          ...insertion.extra,
          kind: TrackKind.Insertion
        }
      }

      this.boombox.queue.add(insertion);
    }
  }
}
