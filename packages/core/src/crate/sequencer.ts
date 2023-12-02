import { TypedEmitter } from "tiny-typed-emitter";
import { chain, debounce, isObjectLike, isString } from "lodash";
import { TrackCollection } from "../collections";
import { SequencedTrack, Track, TrackExtra, TrackSequencing } from "../track";
import { Crate } from "./base";
import { ILogObj, Logger, createLogger } from "../logging";
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
  #crates: Array<Crate<T>>;
  #playCounter = 0;
  #crateIndex = 0;
  #lastCrate: Crate<T> | undefined;
  #currentCollection: T['collection'] | undefined;

  #logger: Logger<ILogObj>;

  constructor(readonly id: string, crates: Array<Crate<T>>, public options: CrateSequencerOptions<E> = {}) {
    super();

    this.#logger = createLogger({
      name: `sequencer/${this.id}`
    });

    this.#crates = crates;
  }

  get currentCrate(): Crate<T> | undefined {
    return this.#crates[this.#crateIndex % this.#crates.length];
  }

  #isCrate(o: any): o is Crate<T> {
    return isObjectLike(o) && ((o as Crate<T>).sources[0] instanceof TrackCollection);
  }

  #isExtra(o: any): o is E {
    return isObjectLike(o);
  }

  #logNoCrates = debounce(() => this.#logger.error('No crates'), 1000);

  async nextTrack(): Promise<SequencedTrack<T> | undefined> {
    if (this.#crates.length < 1) {
      this.#logNoCrates();
      return undefined;
    }

    let scanned = 0;
    let ignored = 0;
    let count = this.#crates.length;
    while (count-- > 0) {
      const crate = this.currentCrate;

      if (this.#isCrate(crate)) {
        if (this.#lastCrate !== crate) {
          const oldCrate = this.#lastCrate;
          this.#lastCrate = crate;

          const selected = await crate.select();

          if (!selected) {
            this.next();
            continue;
          }

          this.#logger.debug('Changed to crate', crate.id);

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
                this.#logger.debug(`Removing latch for ${session.collection.id}: count (${session.count}) >= max (${session.max})`)
                this.#removeLatch(session);

                return;
              }

              return session;
            })();

            // Check the _playCounter only if the latching is not active
            if (latchSession === undefined && (this.#playCounter + 1) > crate.max) {
              // Stop searching for next track and flow to the next crate
              // With #lastCrate being undefined will cause the selection process to kick in again
              this.#lastCrate = undefined;
              break;
            }

            const { trackValidator, trackVerifier } = this.options;

            const latchingCollection = latchSession?.collection;

            if (latchingCollection) {
              this.#logger.debug('Using collection', latchingCollection.id, 'for latching');
            }

            const track = await crate.next(trackValidator, latchingCollection);

            if (track) {
              const { shouldPlay, extra } = trackVerifier ? await trackVerifier(track) : { shouldPlay: true, extra: undefined };

              if (shouldPlay) {
                this.increasePlayCount();

                this.#currentCollection = track.collection;

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
                  playOrder: [this.#playCounter, crate.max],
                  latch: latch as any
                }

                track.extra = this.#isExtra(extra) ? extra : undefined;

                this.#logger.debug('Next track (', this.#playCounter, '/', crate.max, ') =>', track.path);

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
      this.#logger.debug('Tracks were found but none were allowed to play, rescuing...');
      this.emit('rescue', scanned, ignored);
    }

    return undefined;
  }

  #ensureCrateIndex(index: number) {
    return (index % this.#crates.length) || 0;
  }

  getCrateIndex() {
    return this.#crateIndex;
  }

  setCrateIndex(newIndex: number, forceSelect?: boolean) {
    const oldIndex = this.#crateIndex;
    this.#crateIndex = this.#ensureCrateIndex(newIndex);

    if (oldIndex === newIndex) {
      return;
    }

    this.#playCounter = 0;

    if (forceSelect) {
      this.#lastCrate = this.currentCrate;
      this.currentCrate?.select(true);
    }
  }

  increasePlayCount() {
    return ++this.#playCounter;
  }

  next() {
    this.#playCounter = 0;

    if (this.#crates.length <= 0) {
      throw new Error('There is no crate');
    }

    this.setCrateIndex(this.#crateIndex + 1);
    //
    this.#logger.debug('next', this.currentCrate?.id);
  }

  setCurrentCrate(crate: Crate<T> | number) {
    const index = (typeof crate !== 'number') ? this.#crates.indexOf(crate) : crate;

    if (index >= 0 && index < this.#crates.length) {
      this.#crateIndex = index;
    }
  }

  get crates(): Array<Crate<T>> {
    return [...this.#crates];
  }

  set crates(newCrates: Array<Crate<T>>) {
    this.#alterCrates(() => void(this.#crates = newCrates));
  }

  async #alterCrates(fn: () => any) {
    const oldCurrent = this.currentCrate;
    const savedId = oldCurrent?.id;

    await fn();

    let newIndex = this.#ensureCrateIndex(this.#crateIndex);

    if (savedId) {
      const found = this.#crates.findIndex(crate => crate.id === savedId);

      if (found !== -1) {
        newIndex = found;
      }
    }

    this.setCrateIndex(newIndex);
  }

  addCrates(...crates: Array<Crate<T>>) {
    this.#alterCrates(() => {
      this.#crates = chain(this.#crates)
        .push(...crates)
        .uniqBy(c => c.id)
        .value();
    });
  }

  removeCrates(...cratesOrIds: Array<Crate<T>['id'] | Crate<T>>) {
    const toBeRemoved = cratesOrIds.map(w => isString(w) ? w : w.id);

    this.#alterCrates(() => {
      for (const id of toBeRemoved) {
        if (id) {
          const index = this.#crates.findIndex(c => c.id === id)

          if (index !== -1) {
            this.#crates.splice(index, 1);
          }
        }
      }
    });
  }

  moveCrates(newPosition: number, ...cratesOrIds: Array<Crate<T>['id'] | Crate<T>>) {
    this.#alterCrates(() => {
      const toMove = cratesOrIds.map(w => this.crates.findIndex(c => c.id === (isString(w) ? w : w.id)));
      moveArrayIndexes(this.#crates, newPosition, ...toMove);
    });
  }

  isKnownCollection(collection: T['collection']): boolean {
    return this.#crates.find(c => c.sources.includes(collection)) !== undefined;
  }

  #latchSessions: Array<LatchSession<T, E>> = [];

  getActiveLatch(): LatchSession<T, E> | undefined {
    return this.#latchSessions.at(0);
  }

  get allLatches(): Array<LatchSession<T, E>> {
    return [...this.#latchSessions];
  }

  #removeLatch(session: number | LatchSession<T, E>) {
    const index = typeof session === 'number' ? session : this.#latchSessions.indexOf(session);

    if (index > -1) {
      const removingSession = this.#latchSessions[index];
      this.#latchSessions.splice(index, 1);
      removingSession.max = 0;
      return removingSession;
    }
  }

  #getLatchSessionFor(collection: T['collection'] | undefined, important?: boolean): LatchSession<T, E> | undefined {
    const existingIndex = collection ? this.#latchSessions.findIndex(s => s.collection.id === collection.id) : -1;

    if (existingIndex > -1) {
      const existing = this.#latchSessions[existingIndex];

      if (important) {
        this.#latchSessions.splice(existingIndex, 1);
        this.#latchSessions.unshift(existing);
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

    if (this.#currentCollection?.id !== collection.id) {
      this.#playCounter = 0;
    }

    if (important) {
      this.#latchSessions.unshift(newSession);
    } else {
      this.#latchSessions.push(newSession);
    }

    return newSession;
  }

  latch(options?: LatchOptions<T>): LatchSession<T, E> | undefined {
    if (options === undefined) {
      return this.getActiveLatch();
    }

    if (options.increase === false && options.length === 0) {
      return this.#removeLatch(0);
    }

    const collection = options.collection
      ?? this.getActiveLatch()?.collection
      ?? this.#currentCollection;

    const session = this.#getLatchSessionFor(collection, options.important);

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
      return this.#removeLatch(session);
    }

    return session;
  }
}
