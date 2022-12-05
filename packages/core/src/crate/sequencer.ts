import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import { chain, isObjectLike, isString } from "lodash";
import { TrackCollection } from "../collections";
import { Track, TrackExtra, TrackExtraOf } from "../track";
import { Crate } from "./base";
import { createLogger } from "../logging";
import { moveArrayIndexes } from "../utils";
import { randomUUID } from "crypto";

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

export type LatchSession<T extends Track<any, CE>, CE = any> = {
  uuid: string;
  count: number;
  max: number;
  collection: TrackCollection<T>;
}

type LatchWithLength = {
  increase: false;
  length: number;
}

type LatchIncrement = {
  increase: number;
}

export type LatchOptions<T extends Track<any, CE>, CE = any> = (LatchWithLength | LatchIncrement) & {
  collection?: TrackCollection<T>;
  important?: boolean;
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
            {
              if (this.activeLatch && this.activeLatch.count>= this.activeLatch.max) {
                // Ends latching
                this.logger.debug(`Removing activeLatch because activeLatch.count (${this.activeLatch.count})>= activeLatch.max (${this.activeLatch.max})`)
                this.removeActiveLatch();
              }
            }

            const { activeLatch } = this;

            // Check the _playCounter only if the latching is not active
            if (activeLatch === undefined && (this._playCounter + 1) > crate.max) {
              // Stop searching for next track and flow to the next crate
              // With _lastCrate being undefined will cause the selection process to kick in again
              this._lastCrate = undefined;
              break;
            }

            const { trackValidator, trackVerifier } = this.options;

            const latchingCollection = activeLatch?.collection;

            if (latchingCollection) {
              this.logger.debug('Using collection', latchingCollection.id, 'for latching');
            }

            const track = await crate.next(trackValidator, latchingCollection);

            if (track) {
              const { shouldPlay, extra } = trackVerifier ? await trackVerifier(track) : { shouldPlay: true, extra: undefined };

              if (shouldPlay) {
                ++this._playCounter;

                this._currentCollection = track.collection as unknown as TrackCollection<T, any> ;

                track.sequencing.crate = crate as unknown as Crate<Track<E>>;
                track.sequencing.playOrder = [this._playCounter, crate.max];
                track.sequencing.latch = undefined;
                track.extra = this.isExtra(extra) ? extra : undefined;

                if (activeLatch) {
                  activeLatch.count++;

                  track.sequencing.latch = {
                    session: activeLatch as unknown as LatchSession<Track<E>>,
                    order: activeLatch.count
                  }
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
      this.logger.debug('Tracks were found but none were allowed to play, rescuing...');
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
      this._crates = chain(this._crates)
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

  isKnownCollection(collection: TrackCollection<T>): boolean {
    return this._crates.find(c => c.sources.includes(collection)) !== undefined;
  }

  private latchSessions: LatchSession<T>[] = [];

  get activeLatch(): LatchSession<T> | undefined {
    return this.latchSessions.at(0);
  }

  get latestLatch(): LatchSession<T> | undefined {
    return this.latchSessions.at(-1);
  }

  get allLatches(): LatchSession<T>[] {
    return [...this.latchSessions];
  }

  private removeActiveLatch() {
    if (this.latchSessions.length > 0) {
      this.latchSessions.shift();
    }
  }

  private removeLatch(session: number | LatchSession<T>) {
    const index = typeof session === 'number' ? session : this.latchSessions.indexOf(session);

    if (index > -1) {
      const removingSession = this.latchSessions[index];
      this.latchSessions.splice(index, 1);
      removingSession.max = 0;
      return removingSession;
    }
  }

  private getLatchSessionFor(collection: TrackCollection<T> | undefined, important?: boolean): LatchSession<T> | undefined {
    const existingIndex = collection ? this.latchSessions.findIndex(s => s.collection.id === collection.id) : -1;

    if (existingIndex > -1) {
      const existing = this.latchSessions[existingIndex];

      if (important) {
        this.latchSessions.splice(existingIndex, 1);
        this.latchSessions.unshift(existing);
      }

      return existing;
    }

    if (!collection || collection.latchDisabled) {
      return;
    }

    const newSession: LatchSession<T> = {
      uuid: randomUUID(),
      count: 0,
      max: 0,
      collection
    }

    if (important) {
      this.latchSessions.unshift(newSession);
    } else {
      this.latchSessions.push(newSession);
    }

    return newSession;
  }

  latch(options?: LatchOptions<T>): LatchSession<T> | undefined {
    if (options === undefined) {
      return this.activeLatch;
    }

    if (options.increase === false && options.length === 0) {
      return this.removeLatch(0);
    }

    const collection = options.collection
      ?? this.activeLatch?.collection
      ?? this._currentCollection;

    const session = this.getLatchSessionFor(collection, options.important);

    if (!session) {
      return;
    }

    if (options.increase === false) {
      if (!isNaN(options.length)) {
        session.max = Math.max(0, options.length);
        session.count = 0;
      }
    } else if (options.increase) {
      session.max += options.increase;
    }

    if (session.max === 0) {
      this.removeLatch(session);
    }

    return session;
  }
}
