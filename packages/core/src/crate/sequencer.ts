import { TypedEmitter } from "tiny-typed-emitter";
import { chain, isObjectLike, isString } from "lodash";
import { TrackCollection } from "../collections";
import { SequencedTrack, Track, TrackExtra, TrackSequencing } from "../track";
import { Crate } from "./base";
import { createLogger } from "../logging";
import { randomUUID } from "crypto";
import { moveArrayIndexes } from "@seamless-medley/utils";

export type CrateSequencerEvents<T extends Track<any>> = {
  change: (crate: Crate<T>, oldCrate?: Crate<T>) => void;
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

export type LatchSession<T extends Track<E>, E extends TrackExtra> = {
  uuid: string;
  count: number;
  max: number;
  collection: T['collection'];
}

type LatchWithLength = {
  increase: false;
  length: number;
}

type LatchIncrement = {
  increase: number;
}

export type LatchOptions<T extends Track<any>> = (LatchWithLength | LatchIncrement) & {
  collection?: T['collection'];
  important?: boolean;
}

export class CrateSequencer<T extends Track<E>, E extends TrackExtra> extends TypedEmitter<CrateSequencerEvents<T>> {
  private _playCounter = 0;
  private _crateIndex = 0;
  private _lastCrate: Crate<T> | undefined;
  private _currentCollection: T['collection'] | undefined;

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
    return isObjectLike(o) && ((o as Crate<T>).sources[0] instanceof TrackCollection);
  }

  private isExtra(o: any): o is E {
    return isObjectLike(o);
  }

  async nextTrack(): Promise<SequencedTrack<T> | undefined> {
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

          this.emit('change',
            crate,
            oldCrate
          );
        }

        for (const source of crate.sources) {
          scanned += source.length;
          for (let i = 0; i < source.length; i++) {

            const latchSession = (() => {
              const session = this.getActiveLatch();

              if (session && session.count>= session.max) {
                // Ends latching
                this.logger.debug(`Removing latch for ${session.collection.id}: count (${session.count}) >= max (${session.max})`)
                this.removeLatch(session);

                return;
              }

              return session;
            })();

            // Check the _playCounter only if the latching is not active
            if (latchSession === undefined && (this._playCounter + 1) > crate.max) {
              // Stop searching for next track and flow to the next crate
              // With _lastCrate being undefined will cause the selection process to kick in again
              this._lastCrate = undefined;
              break;
            }

            const { trackValidator, trackVerifier } = this.options;

            const latchingCollection = latchSession?.collection;

            if (latchingCollection) {
              this.logger.debug('Using collection', latchingCollection.id, 'for latching');
            }

            const track = await crate.next(trackValidator, latchingCollection);

            if (track) {
              const { shouldPlay, extra } = trackVerifier ? await trackVerifier(track) : { shouldPlay: true, extra: undefined };

              if (shouldPlay) {
                this.increasePlayCount();

                this._currentCollection = track.collection;

                let latch: TrackSequencing<T, E>['latch'];

                if (latchSession) {
                  latchSession.count++;

                  latch = {
                    session: latchSession,
                    order: latchSession.count
                  }
                }

                track.sequencing = {
                  crate: crate as any,
                  playOrder: [this._playCounter, crate.max],
                  latch: latch as any
                }

                track.extra = this.isExtra(extra) ? extra : undefined;

                this.logger.debug('Next track (', this._playCounter, '/', crate.max, ') =>', track.path);

                return track as unknown as SequencedTrack<T>;
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

  getCrateIndex() {
    return this._crateIndex;
  }

  setCrateIndex(newIndex: number, forceSelect?: boolean) {
    const oldIndex = this._crateIndex;
    this._crateIndex = this.ensureCrateIndex(newIndex);

    if (oldIndex === newIndex) {
      return;
    }

    this._playCounter = 0;

    if (forceSelect) {
      this._lastCrate = this.currentCrate;
      this.currentCrate?.select(true);
    }
  }

  increasePlayCount() {
    return ++this._playCounter;
  }

  next() {
    this._playCounter = 0;

    if (this._crates.length <= 0) {
      throw new Error('There is no crate');
    }

    this.setCrateIndex(this._crateIndex + 1);
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

    this.setCrateIndex(newIndex);
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

  isKnownCollection(collection: T['collection']): boolean {
    return this._crates.find(c => c.sources.includes(collection)) !== undefined;
  }

  private latchSessions: LatchSession<T, E>[] = [];

  getActiveLatch(): LatchSession<T, E> | undefined {
    return this.latchSessions.at(0);
  }

  get allLatches(): LatchSession<T, E>[] {
    return [...this.latchSessions];
  }

  private removeLatch(session: number | LatchSession<T, E>) {
    const index = typeof session === 'number' ? session : this.latchSessions.indexOf(session);

    if (index > -1) {
      const removingSession = this.latchSessions[index];
      this.latchSessions.splice(index, 1);
      removingSession.max = 0;
      return removingSession;
    }
  }

  private getLatchSessionFor(collection: T['collection'] | undefined, important?: boolean): LatchSession<T, E> | undefined {
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

    const newSession: LatchSession<T, E> = {
      uuid: randomUUID(),
      count: 0,
      max: 0,
      collection
    }

    if (this._currentCollection?.id !== collection.id) {
      this._playCounter = 0;
    }

    if (important) {
      this.latchSessions.unshift(newSession);
    } else {
      this.latchSessions.push(newSession);
    }

    return newSession;
  }

  latch(options?: LatchOptions<T>): LatchSession<T, E> | undefined {
    if (options === undefined) {
      return this.getActiveLatch();
    }

    if (options.increase === false && options.length === 0) {
      return this.removeLatch(0);
    }

    const collection = options.collection
      ?? this.getActiveLatch()?.collection
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
      return this.removeLatch(session);
    }

    return session;
  }
}
