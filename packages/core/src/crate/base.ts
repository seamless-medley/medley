import { TrackCollection } from "../collections/base";
import { Track } from "../track";

export class Crate<T extends Track<any>> {
  constructor(readonly id: string, public source: TrackCollection<T>, public max: number) {

  }

  async next(validator?: (path: string) => Promise<boolean>): Promise<T | undefined> {
    const item = this.source.shift();

    const isValid = item && validator ? await validator(item.path) : true;

    if (isValid && item) {
      this.source.push(item);
    }

    return item;
  }
}