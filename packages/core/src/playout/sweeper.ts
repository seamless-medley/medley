import { curry, without } from "lodash";
import { TrackCollection } from "../collections";
import { BoomBox, BoomBoxEvents, BoomBoxTrack, TrackKind } from "./boombox";

export type SweeperInsertionRule = {
  from?: string[];
  to?: string[];
  collection: TrackCollection<BoomBoxTrack>;
}

const isIn = (value: string, list: string[] | undefined) => !list || list.includes(value);

const validateRule = (from: [id: string, list: string[] | undefined] | undefined, to: [id: string, list: string[] | undefined]) => {
  const [toId, toList] = to;

  if (!from) {
    return isIn(toId, toList);
  }

  const [fromId, fromList] = from;

  if (isIn(fromId, toList)) {
    return false;
  }

  return isIn(fromId, fromList) && isIn(toId, without(toList, ...(fromList ?? [])));
}

const matchRule = curry((from: string | undefined, to: string, rule: SweeperInsertionRule) => validateRule(
    from ? [from, rule.from] : undefined,
    [to, rule.to]
  )
);

const findRule = (from: string | undefined, to: string, rules: SweeperInsertionRule[]) => rules.find(matchRule(from, to));

export class SweeperInserter {
  constructor(private boombox: BoomBox, public rules: SweeperInsertionRule[] = []) {
    boombox.on('currentCollectionChange', this.handler);
  }

  private handler: BoomBoxEvents['currentCollectionChange'] = (oldCollection, newCollection, ignoreFrom) => {
    const matched = findRule(!ignoreFrom ? oldCollection.id : undefined, newCollection.id, this.rules);

    if (!matched) {
      return;
    }

    const insertion = matched.collection.shift();
    if (insertion) {
      // ensure track kind
      if (insertion.extra?.kind === undefined) {
        insertion.extra = {
          ...insertion.extra,
          kind: TrackKind.Insertion
        }
      }

      this.boombox.queue.add(insertion);
      matched.collection.push(insertion);
    }
  }
}
