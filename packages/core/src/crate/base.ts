import { TrackCollection } from "../collections/base";
import { Track } from "../track";

export class Crate<M = void> {
  constructor(readonly id: string, public source: TrackCollection<M>, public max: number) {

  }

  next(): Track<M> | undefined {
    const item = this.source.shift();

    if (item) {
      this.source.push(item);
    }

    return item;
  }
}