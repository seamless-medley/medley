import { curry, without } from "lodash";
import { TrackCollection } from "../collections";
import { BoomBox, BoomBoxEvents, BoomBoxTrack, TrackKind } from "./boombox";

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
    boombox.on('currentCollectionChange', this.handler);
  }

  private handler: BoomBoxEvents['currentCollectionChange'] = (oldCollection, newCollection) => {
    const matched = findRule(oldCollection.id, newCollection.id, this.rules);

    if (matched) {
      const insertion = matched.collection.shift();
      if (insertion) {
        // ensure track kind
        if (!insertion.metadata?.kind) {
          insertion.metadata = {
            ...insertion.metadata,
            kind: TrackKind.Insertion
          }
        }

        this.boombox.queue.add(insertion);
        matched.collection.push(insertion);
      }
    }
  }
}