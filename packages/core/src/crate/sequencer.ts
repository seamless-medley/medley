import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import { isObjectLike } from "lodash";
import { TrackCollection } from "../collections";
import { Track } from "../track";
import { Crate } from "./base";

export interface CrateSequencerEvents {
  change: (crate: Crate) => void;
}
export class CrateSequencer<M extends object | void = void> extends (EventEmitter as new () => TypedEventEmitter<CrateSequencerEvents>) {
  private _playCounter = 0;
  private _crateIndex = 0;
  private _lastCrate: Crate<M> | undefined;

  constructor(public crates: Crate<M>[] = []) {
    super();
    this._lastCrate = this.current;
  }

  get current(): Crate<M> | undefined {
    return this.crates[this._crateIndex];
  }

  private isCrate(o: any): o is Crate<M> {
    return isObjectLike(o) && (o.source instanceof TrackCollection);
  }

  private isMetadata(o: any): o is M {
    return isObjectLike(o);
  }

  async nextTrack(validator?: (path: string) => Promise<M | boolean>): Promise<Track<M> | undefined> {
    if (this.crates.length < 1) {
      return undefined;
    }

    let count = this.crates.length;
    while (count-- > 0) {
      const crate = this.current;

      if (this.isCrate(crate)) {
        if (this._lastCrate !== crate) {
          this._lastCrate = crate;
          this.emit('change', crate as unknown as Crate);
        }

        for (let i = 0; i < crate.source.length; i++) {
          const track = crate.next();

          if (track) {
            const valid = validator ? await validator(track.path) : true;

            if (!!valid) {
              if (++this._playCounter >= crate.max) {
                this.next();
              }

              track.crate = crate;

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

  // TODO: Method for setting crateIndex, by the Crate object or by number
}