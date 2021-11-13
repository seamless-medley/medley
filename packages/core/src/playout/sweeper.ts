import { curry, without } from "lodash";
import { TrackCollection } from "../collections";
import { BoomBox, BoomBoxEvents, BoomBoxTrack } from "./boombox";

export type SweeperInsertionRule = {
  from?: string[];
  to?: string[];
  collection: TrackCollection<BoomBoxTrack>;
};

const isIn = (value: string, list: string[] | undefined) => !list || list.includes(value);

const validateRule = (predicates: [string, string[] | undefined][]) => {
  const [from, to] = predicates;
  const [fromId, fromList] = from;
  const [toId, toList] = to;

  if (isIn(fromId, toList)) {
    return false;
  }

  return isIn(fromId, fromList) && isIn(toId, without(toList));
};

const matchRule = curry((from: string, to: string, rule: SweeperInsertionRule) => validateRule([
    [from, rule.from],
    [to, rule.to]
  ])
);

const findRule = (from: string, to: string, rules: SweeperInsertionRule[]) => rules.find(matchRule(from, to));

export class SweeperInserter {
  constructor(private boombox: BoomBox, public rules: SweeperInsertionRule[] = []) {
    boombox.on('currentCrateChange', this.handler);
  }

  private handler: BoomBoxEvents['currentCrateChange'] = (oldCrate, newCrate) => {
    const matched = findRule(oldCrate.source.id, newCrate.source.id, this.rules);

    if (matched) {
      const insertion = matched.collection.shift();
      if (insertion) {
        this.boombox.queue.add(insertion);
        matched.collection.push(insertion);
      }
    }
  }
}