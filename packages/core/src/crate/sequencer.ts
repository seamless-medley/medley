import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import _, { clamp, isObjectLike, isString, uniqBy } from "lodash";
import { TrackCollection } from "../collections";
import { Track, TrackExtra, TrackExtraOf } from "../track";
import { Crate } from "./base";
import { createLogger } from "../logging";
import { moveArrayIndexes } from "../utils";

export interface CrateSequencerEvents {
  change: (crate: Crate<Track<any>>, oldCrate?: Crate<Track<any>>) => void;
  rescue: (scanned: number, ignore: number) => void;
}

export type TrackValidator = {
  (path: string): Promise<boolean>;
}

export type TrackVerifier<E extends TrackExtra> = {
  (track: Track<E>): Promise<TrackVerifierResult<E>>;
}

export type TrackVerifierResult<E> = {
  shouldPlay: boolean;
  extra?: E;
}

export type CrateSequencerOptions<E extends TrackExtra> = {
  trackValidator?: TrackValidator;
  trackVerifier?: TrackVerifier<E>;
}

export class CrateSequencer<T extends Track<E>, E extends TrackExtra = TrackExtraOf<T>> extends (EventEmitter as new () => TypedEventEmitter<CrateSequencerEvents>) {
  private _playCounter = 0;
  private _crateIndex = 0;
  private _lastCrate: Crate<T> | undefined;
  private _currentCollection: TrackCollection<T, any> | undefined;

  private logger = createLogger({
    name: `sequencer/${this.id}`
  })

  constructor(readonly id: string, private _crates: Crate<T>[], private options: CrateSequencerOptions<E> = {}) {
    super();
  }

  get currentCrate(): Crate<T> | undefined {
    return this._crates[this._crateIndex % this._crates.length];
  }

  private isCrate(o: any): o is Crate<T> {
    return isObjectLike(o) && ((o as Crate<any>).sources[0] instanceof TrackCollection);
  }

  private isExtra(o: any): o is E {
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
      const crate = this.currentCrate;

      if (this.isCrate(crate)) {
        if (this._lastCrate !== crate) {
          const oldCrate = this._lastCrate;
          this._lastCrate = crate;

          const selected = await crate.select();

          if (!selected) {
            this.next();
            continue;
          }

          this.logger.debug('Changed to crate', crate.id);

          this.emit('change', crate as unknown as Crate<Track<E>>, oldCrate as unknown as Crate<Track<E>>);
        }

        for (const source of crate.sources) {
          scanned += source.length;
          for (let i = 0; i < source.length; i++) {

            if (this.latchFor && this.latchCount >= this.latchFor) {
              // Ends latching
              this.logger.debug('LATCH ENDED');
              this.latchCount = 0;
              this.latchFor = 0;
            }

            // Check the _playCounter only if the latching is not active
            if ((this.latchFor === 0) && (this._playCounter + 1) > crate.max) {
              // Stop searching for next track and flow to the next crate
              this._lastCrate = undefined;
              break;
            }

            const { trackValidator, trackVerifier } = this.options;

            const track = await crate.next(trackValidator);

            if (track) {
              const { shouldPlay, extra } = trackVerifier ? await trackVerifier(track) : { shouldPlay: true, extra: undefined };

              if (shouldPlay) {
                ++this._playCounter;

                this._currentCollection = track.collection as unknown as TrackCollection<T, any> ;

                track.sequencing.crate = crate as unknown as Crate<Track<E>>;
                track.sequencing.playOrder = [this._playCounter, crate.max];
                track.sequencing.latch = undefined;
                track.extra = this.isExtra(extra) ? extra : undefined;

                if (this.latchFor > 0) {
                  ++this.latchCount;

                  this.logger.debug('LATCH INC', this.latchCount, this.latchFor);

                  track.sequencing.latch = [this.latchCount, this.latchFor];
                }

                this.logger.debug('Next track (', this._playCounter, '/', crate.max, ') =>', track.path);

                return track;
              }
              // track should be skipped, go to next track
            }
            // track is neither valid nor defined, go to next track
            ignored++;
          }
        }
        // no more track
      }

      // no more track nor crate is valid, go to next crate
      this.next();
    }

    // no valid track in any crates
    if (ignored === scanned && scanned > 0) {
      // Rescue, tracks were found but none was allowed to play
      this.logger.debug('Tracks were found but none was allowed to play, rescuing...');
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
    //
    this.logger.debug('next', this.currentCrate?.id);
  }

  setCurrentCrate(crate: Crate<T> | number) {
    const index = (typeof crate !== 'number') ? this._crates.indexOf(crate) : crate;

    if (index >= 0 && index < this._crates.length) {
      this._crateIndex = index;
    }
  }

  get crates(): ReadonlyArray<Crate<T>> {
    return this._crates;
  }

  private async alterCrates(fn: () => any) {
    const oldCurrent = this.currentCrate;
    const savedId = oldCurrent?.id;

    await fn();

    let newIndex = this.ensureCrateIndex(this._crateIndex);

    if (savedId) {
      const found = this._crates.findIndex(crate => crate.id === savedId);

      if (found !== -1) {
        newIndex = found;
      }
    }

    this.crateIndex = newIndex;
  }

  addCrates(...crates: Crate<T>[]) {
    this.alterCrates(() => {
      this._crates = _(this._crates)
        .push(...crates)
        .uniqBy(c => c.id)
        .value();
    });
  }

  removeCrates(...cratesOrIds: Array<Crate<T>['id'] | Crate<T>>) {
    const toBeRemoved = cratesOrIds.map(w => isString(w) ? w : w.id);

    this.alterCrates(() => {
      for (const id of toBeRemoved) {
        if (id) {
          const index = this._crates.findIndex(c => c.id === id)

          if (index !== -1) {
            this._crates.splice(index, 1);
          }
        }
      }
    });
  }

  moveCrates(newPosition: number, ...cratesOrIds: Array<Crate<T>['id'] | Crate<T>>) {
    this.alterCrates(() => {
      const toMove = cratesOrIds.map(w => this.crates.findIndex(c => c.id === (isString(w) ? w : w.id)));
      moveArrayIndexes(this._crates, newPosition, ...toMove);
    });
  }

  private latchFor: number = 0;
  private latchCount: number = 0;

  latch(n?: number) {
    if (n !== undefined) {
      this.latchFor = isNaN(n) ? 0 : Math.max(0, n);
      this.latchCount = 0;
    }

    return [this.latchCount, this.latchFor] as [count: number, total: number];
  }
}
