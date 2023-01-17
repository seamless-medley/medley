import { curry, sample, sortBy } from "lodash";
import { basename } from "path";
import { createLogger, Logger, type ILogObj } from "../logging";
import { BoomBox, BoomBoxEvents, BoomBoxTrackCollection, TrackKind } from "./boombox";

export type SweeperInsertionRule = {
  from?: string[];
  to?: string[];
  collection: BoomBoxTrackCollection;
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
  private logger: Logger<ILogObj>;

  constructor(private boombox: BoomBox, public rules: SweeperInsertionRule[] = []) {
    this.logger = createLogger({ name: `${boombox.id}/sweeper-inserter` });
    boombox.on('currentCollectionChange', this.handler);
  }

  private recent: string[] = [];

  private pick(collection: BoomBoxTrackCollection) {
    const count = this.recent.length + 1;

    for (let i = 0; i < count; i++) {
      for (let j = 0; j < collection.length; j++) {
        const track = collection.shift();

        if (track) {
          collection.push(track);

          const id = track.musicId ?? basename(track.path).toLowerCase();
          this.logger.debug('Insetion id', id);

          if (!this.recent.includes(id)) {
            this.recent.push(id);
            return track;
          }
        }
      }

      this.recent.shift();
    }

    return collection.sample();
  }

  private handler: BoomBoxEvents['currentCollectionChange'] = (oldCollection, newCollection, ignoreFrom) => {
    if (!oldCollection) {
      return;
    }

    const matched = findRule(oldCollection.id, newCollection.id, this.rules, ignoreFrom);

    if (!matched) {
      return;
    }

    const insertion = this.pick(matched.collection);
    if (insertion) {
      this.logger.info('Inserting', insertion.path);
      // ensure track kind
      if (insertion.extra?.kind === undefined) {
        insertion.extra = {
          ...insertion.extra,
          kind: TrackKind.Insertion
        }
      }

      this.boombox.queue.add({
        ...insertion,
        disableNextLeadIn: true
      });
    }
  }
}
