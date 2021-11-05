import { TrackCollection } from "../collections/base";
import { Track } from "../track";

export class Crate<T extends Track<any>> {
  constructor(readonly id: string, public source: TrackCollection<T>, public max: number) {

  }

  next(): T | undefined {
    const item = this.source.shift();

    if (item) {
      this.source.push(item);
    }

    return item;
  }
}