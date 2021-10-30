import EventEmitter from "events";
import { Track } from "../track";
import { Crate } from "./base";

export class CrateSequencer extends EventEmitter {

  constructor(public crates: Crate[] = []) {
    super();
  }

  private _playCounter = 0;
  private _crateIndex = 0;

  get current(): Crate | undefined {
    return this.crates[this._crateIndex];
  }

  nextTrack(validator?: (path: string) => boolean): Track | undefined {
    if (this.crates.length < 1) {
      throw new Error('No crate');
    }

    let count = this.crates.length;

    while (count-- > 0) {
      const crate = this.current;

      if (crate) {
        for (let i = 0; i < crate.source.length; i++) {
          const track = crate.next();

          if (track) {
            const valid = validator?.(track.path) ?? true;

            if (valid) {
              if (++this._playCounter >= crate.max) {
                this.next();
              }

              track.crate = crate;
              return track;
            }
          }
        }
      }

      // try next
      this.next();
    }

    throw new Error('No track');
  }

  next(): Crate {
    this._playCounter = 0;

    if (this.crates.length <= 0) {
      throw new Error('There is no crate');
    }

    this._crateIndex = (this._crateIndex + 1) % this.crates.length;
    // // this.emit('next_crate', c); // TODO: Sequence update event
    return this.current!;
  }
}