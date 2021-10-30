import EventEmitter from "events";
import { isObjectLike } from "lodash";
import { TrackCollection } from "..";
import { Track } from "../track";
import { Crate } from "./base";

export class CrateSequencer extends EventEmitter {
  private _playCounter = 0;
  private _crateIndex = 0;
  private _lastCrate: Crate | undefined;

  constructor(public crates: Crate[] = []) {
    super();
    this._lastCrate = this.current;
  }

  get current(): Crate | undefined {
    return this.crates[this._crateIndex];
  }

  private isCrate(o: any): o is Crate {
    return isObjectLike(o) && (o.source instanceof TrackCollection);
  }

  nextTrack(validator?: (path: string) => boolean): Track | undefined {
    if (this.crates.length < 1) {
      return undefined;
    }

    let count = this.crates.length;
    while (count-- > 0) {
      const crate = this.current;

      if (this.isCrate(crate)) {
        if (this._lastCrate !== crate) {
          console.log('Crate change');
          this._lastCrate = crate;
          // this.emit('next_crate', c); // TODO: Sequence update event
        }

        for (let i = 0; i < crate.source.length; i++) {
          const track = crate.next();

          if (track) {
            const valid = validator ? validator(track.path) : true;

            if (valid) {
              if (++this._playCounter >= crate.max) {
                this.next();
              }

              track.crate = crate;
              return track;
            }
            // track is not valid, go to next track
          }
          // track is neither valid nor defined, go to next track
        }
        // no more track
      }

      // no more track nor crate is valid, go to next crate
      this.next();
    }

    // no valid track in any crates
    return undefined;
  }

  next(): Crate {
    this._playCounter = 0;

    if (this.crates.length <= 0) {
      throw new Error('There is no crate');
    }

    this._crateIndex = (this._crateIndex + 1) % this.crates.length;
    return this.current!;
  }
}