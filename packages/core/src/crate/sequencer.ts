import { TypedEmitter } from "tiny-typed-emitter";
import { debounce, isObjectLike } from "lodash";
import { TrackCollection } from "../collections";
import { SequencedTrack, Track, TrackExtra, TrackSequencing } from "../track";
import { Crate } from "./base";
import { Logger, createLogger } from "@seamless-medley/logging";
import { randomUUID } from "crypto";
import { CrateProfile } from "./profile";

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

interface CrateProfilePrivate<T extends Track<any>> {
  attachSequencer(sequencer: CrateSequencer<T, any>): void;
  detachSequencer(): void;
}

export class CrateSequencer<T extends Track<E>, E extends TrackExtra> extends TypedEmitter<CrateSequencerEvents<T>> {
  #profile = new CrateProfile<T>('$empty');

  #playCounter = 0;
  #crateIndex = 0;
  #lastCrate: Crate<T> | undefined;
  #currentCollection: T['collection'] | undefined;

  #logger: Logger;

  constructor(readonly id: string, public options: CrateSequencerOptions<E> = {}) {
    super();

    this.#logger = createLogger({
      name: 'sequencer',
      id: this.id
    });
  }

  get profile() {
    return this.#profile;
  }

  changeProfile(newProfile: CrateProfile<T>) {
    if (newProfile === this.#profile) {
      return false;
    }

    (this.#profile as unknown as CrateProfilePrivate<T>)?.detachSequencer();
    (newProfile as unknown as CrateProfilePrivate<T>).attachSequencer(this);

    const currentCollectionId = this.#currentCollection?.id;

    this.#profile = newProfile;
    this.#playCounter = 0;

    const crateIndex = currentCollectionId ? this.#findCrateIndexContainingCollection(currentCollectionId) : 0;
    this.#logger.debug({ id: newProfile.id, crateIndex }, 'Change to profile');
    this.#crateIndex = crateIndex > -1 ? this.#ensureCrateIndex(crateIndex) : 0;

    return true;
  }

  #findCrateIndexContainingCollection(id: string) {
    return this.#profile.crates.findIndex(c => c.sources.find(s => s.id === id) !== undefined);
  }

  get #crates() {
    return this.#profile.crates;
  }

  get currentCrate(): Crate<T> | undefined {
    const { crates } = this;
    return crates[this.#crateIndex % crates.length];
  }

  set currentCrate(crate: Crate<T> | number) {
    const index = (typeof crate !== 'number') ? this.#crates.indexOf(crate) : crate;

    if (index >= 0 && index < this.#crates.length) {
      this.#crateIndex = index;
    }
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

  /**
   * Locate the nearest crate index having the spcified collectionId
   */
  locateCrate(collectionId: string) {
    const indices = this.#crates.map((crate, index) => ({ ids: new Set(crate.sources.map(s => s.id)), index }));

    const a = indices.slice(0, this.#crateIndex);
    const b = indices.slice(this.#crateIndex);

    const located = [...b, ...a].find(({ ids }) => ids.has(collectionId));

    return located?.index;
  }

  #isCrate(o: any): o is Crate<T> {
    return isObjectLike(o) && ((o as Crate<T>).sources[0] instanceof TrackCollection);
  }

  #isExtra(o: any): o is E {
    return isObjectLike(o);
  }

  #logNoCrates = debounce(() => this.#logger.error('No crates'), 1000);

  #temporalCollection: T['collection'] | undefined;

  async nextTrack(): Promise<SequencedTrack<T> | undefined> {
    if (this.#crates.length < 1) {
      this.#logNoCrates();
      return undefined;
    }

    let scanned = 0;
    let ignored = 0;
    let count = this.#crates.length;
    while (count-- > 0) {
      const latchSession = this.getActiveLatch();

      if (latchSession) {
        const located = this.locateCrate(latchSession.collection.id);

        if (located !== undefined && located !== this.#crateIndex) {
          this.#logger.debug(
            {
              old: this.#crates[this.#crateIndex].id,
              new: this.#crates[located].id,
            },
            'A latch session is active, moving crate index'
          );

          this.setCrateIndex(located, true);
        }
      }

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

          this.#logger.debug(`Changed to crate ${crate.id}`);

          this.emit('change',
            crate,
            oldCrate
          );
        }

        for (const source of crate.sources) {
          scanned += source.length;

          for (let i = 0; i < source.length; i++) {
            // Check the #playCounter only if the latching is not active
            if (latchSession === undefined && (this.#playCounter + 1) > crate.max) {
              // Stop searching for next track and flow to the next crate
              // With #lastCrate being undefined will cause the selection process to kick in again
              this.#lastCrate = undefined;
              break;
            }

            const { trackValidator, trackVerifier } = this.options;

            const latchingCollection = latchSession?.collection;

            if (latchingCollection) {
              this.#logger.debug(`Using collection ${latchingCollection.id} for latching`);
            }

            const intendedCollection = latchingCollection ?? this.#temporalCollection;
            this.#temporalCollection = undefined;

            const track = await crate.next(trackValidator, intendedCollection);

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
                    order: latchSession.count,
                    max: latchSession.max
                  }

                  if (latchSession.count>= latchSession.max) {
                    // Ends latching
                    this.removeLatch(latchSession);
                  }
                }

                track.sequencing = {
                  crate: crate as any,
                  playOrder: [this.#playCounter, crate.max],
                  latch: latch as any
                }

                track.extra = this.#isExtra(extra) ? extra : undefined;

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
    this.#logger.debug('next ' + this.currentCrate?.id);
  }

  get crates(): ReadonlyArray<Crate<T>> {
    return [...this.#crates];
  }

  isKnownCollection(collection: T['collection']): boolean {
    return this.#crates.find(c => c.sources.includes(collection)) !== undefined;
  }

  forcefullySelectCollection(collection: T['collection']): boolean {
    const crateIndex = this.#crates.findIndex(c => c.sources.includes(collection));
    if (crateIndex === -1) {
      return false;
    }

    this.#temporalCollection = collection;
    this.setCrateIndex(crateIndex, true);
    return false;
  }

  #latchSessions: Array<LatchSession<T, E>> = [];

  getActiveLatch(): LatchSession<T, E> | undefined {
    return this.#latchSessions.at(0);
  }

  get allLatches(): ReadonlyArray<LatchSession<T, E>> {
    return [...this.#latchSessions];
  }

  removeLatch(session: number | string | LatchSession<T, E>) {
    const index = typeof session === 'number'
      ? session
      : typeof session === 'string'
        ? this.#latchSessions.findIndex(s => s.uuid === session)
        : this.#latchSessions.indexOf(session);

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
      return this.removeLatch(0);
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
      return this.removeLatch(session);
    }

    return session;
  }
}
