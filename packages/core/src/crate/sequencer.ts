import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import { isObjectLike } from "lodash";
import { TrackCollection } from "../collections";
import { Track, TrackMetadata } from "../track";
import { Crate } from "./base";

export interface CrateSequencerEvents {
  change: (crate: Crate<Track<any>>) => void;
}

export class CrateSequencer<T extends Track<M>, M = TrackMetadata<T>> extends (EventEmitter as new () => TypedEventEmitter<CrateSequencerEvents>) {
  private _playCounter = 0;
  private _crateIndex = 0;
  private _lastCrate: Crate<T> | undefined;

  constructor(public crates: Crate<T>[] = []) {
    super();
    this._lastCrate = this.current;
  }

  get current(): Crate<T> | undefined {
    return this.crates[this._crateIndex];
  }

  private isCrate(o: any): o is Crate<T> {
    return isObjectLike(o) && (o.source instanceof TrackCollection);
  }

  private isMetadata(o: any): o is M {
    return isObjectLike(o);
  }

  async nextTrack(validator?: (path: string) => Promise<M | boolean>): Promise<T | undefined> {
    if (this.crates.length < 1) {
      return undefined;
    }

    let count = this.crates.length;
    while (count-- > 0) {
      const crate = this.current;

      if (this.isCrate(crate)) {
        if (this._lastCrate !== crate) {
          this._lastCrate = crate;
          this.emit('change', crate as unknown as Crate<Track<any>>);
        }

        for (let i = 0; i < crate.source.length; i++) {
          const track = crate.next();

          if (track) {
            const valid = validator ? await validator(track.path) : true;

            if (valid) {
              this._playCounter++;

              if (this.latchFor > 0) {
                this.latchCount++;

                if (this.latchCount >= this.latchFor) {
                  this.next();

                  this.latchCount = 0;
                  this.latchFor = 0;
                }
              } else if (this._playCounter >= crate.max) {
                this.next();
              }

              track.crate = crate as unknown as Crate<Track<M>>;

              if (this.isMetadata(valid)) {
                track.metadata = valid;
              }

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

  next() {
    this._playCounter = 0;

    if (this.crates.length <= 0) {
      throw new Error('There is no crate');
    }

    this._crateIndex = (this._crateIndex + 1) % this.crates.length;
  }

  setCurrentCrate(crate: Crate<T> | number) {
    const index = (typeof crate !== 'number') ? this.crates.indexOf(crate) : crate;

    if (index >= 0 && index < this.crates.length) {
      this._crateIndex = index;
    }
  }

  private latchFor: number = 0;
  private latchCount: number = 0;

  latch(n: number) {
    this.latchFor = isNaN(n) ? 0 : Math.max(0, n);
    this.latchCount = 0;
  }
}