import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import _, { isObjectLike } from "lodash";
import { TrackCollection } from "../collections";
import { Track, TrackMetadata } from "../track";
import { Crate } from "./base";

export interface CrateSequencerEvents {
  change: (crate: Crate<Track<any>>) => void;
  rescue: (scanned: number, ignore: number) => void;
}

export type TrackValidator = {
  (path: string): Promise<boolean>;
}

export type TrackVerifier<M> = {
  (path: string): Promise<TrackVerifierResult<M>>;
}

export type TrackVerifierResult<M> = {
  shouldPlay: boolean;
  metadata?: M;
}

export type CrateSequencerOptions<M> = {
  trackValidator?: TrackValidator;
  trackVerifier?: TrackVerifier<M>;
}

export class CrateSequencer<T extends Track<M>, M = TrackMetadata<T>> extends (EventEmitter as new () => TypedEventEmitter<CrateSequencerEvents>) {
  private _playCounter = 0;
  private _crateIndex = 0;
  private _lastCrate: Crate<T> | undefined;

  constructor(private _crates: Crate<T>[], private options: CrateSequencerOptions<M> = {}) {
    super();
    this._lastCrate = this.current;
  }

  get current(): Crate<T> | undefined {
    return this._crates[this._crateIndex % this._crates.length];
  }

  private isCrate(o: any): o is Crate<T> {
    return isObjectLike(o) && (o.source instanceof TrackCollection);
  }

  private isMetadata(o: any): o is M {
    return isObjectLike(o);
  }

  async nextTrack(): Promise<T | undefined> {
    if (this._crates.length < 1) {
      return undefined;
    }

    let scanned = 0;
    let ignored = 0;
    let count = this._crates.length;
    while (count-- > 0) {
      const crate = this.current;

      if (this.isCrate(crate)) {
        if (this._lastCrate !== crate) {
          this._lastCrate = crate;
          this.emit('change', crate as unknown as Crate<Track<any>>);
        }

        scanned += crate.source.length;
        for (let i = 0; i < crate.source.length; i++) {
          // Latching is active
          if (this.latchFor > 0) {
            this.latchCount++;

            if (this.latchCount > this.latchFor) {
              this.latchCount = 0;
              this.latchFor = 0;

              // Stop searching for next track and flow to the next crate
              break;
            }
          }

          if ((this._playCounter + 1) > crate.max) {
            // Stop searching for next track and flow to the next crate
            break;
          }

          const { trackValidator, trackVerifier } = this.options;

          const track = await crate.next(trackValidator);

          if (track) {
            const { shouldPlay, metadata } = trackVerifier ? await trackVerifier(track.path) : { shouldPlay: true, metadata: undefined };

            if (shouldPlay) {
              this._playCounter++;

              track.crate = crate as unknown as Crate<Track<M>>;

              if (this.isMetadata(metadata)) {
                track.metadata = metadata;
              }

              return track;
            }
            // track should be skipped, go to next track
          }
          // track is neither valid nor defined, go to next track
          ignored++;
        }
        // no more track
      }

      // no more track nor crate is valid, go to next crate
      this.next();
    }

    // no valid track in any crates
    if (ignored === scanned && scanned > 0) {
      // Rescue, tracks were found but none was allowed to play
      this.emit('rescue', scanned, ignored);
    }

    return undefined;
  }

  private ensureCrateIndex(index: number) {
    return (index % this._crates.length) || 0;
  }

  get crateIndex() {
    return this._crateIndex;
  }

  set crateIndex(newIndex: number) {
    const oldIndex = this._crateIndex;
    this._crateIndex = this.ensureCrateIndex(newIndex);

    if (oldIndex !== newIndex) {
      this._playCounter = 0;
    }
  }

  next() {
    this._playCounter = 0;

    if (this._crates.length <= 0) {
      throw new Error('There is no crate');
    }

    this.crateIndex++;
  }

  setCurrentCrate(crate: Crate<T> | number) {
    const index = (typeof crate !== 'number') ? this._crates.indexOf(crate) : crate;

    if (index >= 0 && index < this._crates.length) {
      this._crateIndex = index;
    }
  }

  get crates() {
    return this._crates;
  }

  set crates(newCrates: Crate<T>[]) {
    const oldCurrent = this.current;
    const saved = oldCurrent ? { id: oldCurrent.source.id, max: oldCurrent.max } : undefined;

    this._crates = newCrates;

    let newIndex = this.ensureCrateIndex(this._crateIndex);

    if (saved) {
      let found = this._crates.findIndex(crate => crate.source.id === saved.id && crate.max === saved.max);
      if (found === -1) {
        found = this._crates.findIndex(crate => crate.source.id === saved.id);
      }

      if (found !== -1) {
        newIndex = found;
      }
    }

    this.crateIndex = newIndex;
  }

  private latchFor: number = 0;
  private latchCount: number = 0;

  latch(n: number) {
    this.latchFor = isNaN(n) ? 0 : Math.max(0, n);
    this.latchCount = 0;
  }
}