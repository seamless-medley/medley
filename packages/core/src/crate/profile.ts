import { chain, isString } from "lodash";
import { Track } from "../track";
import { Crate, CreatePrivate as CratePrivates } from "./base";
import { CrateSequencer } from "./sequencer";
import { moveArrayIndexes } from "@seamless-medley/utils";
import { Library } from "../library";

export type CrateProfileOptions<T extends Track<any>> = {
  id: string;
  name: string;
  description?: string;
  crates?: Array<Crate<T>>;
}

export class CrateProfile<T extends Track<any>> {
  readonly id: string;

  name: string;

  description?: string;

  #crates: Array<Crate<T>>;

  #sequencer?: CrateSequencer<T, any,  CrateProfile<T>>;

  constructor(options: CrateProfileOptions<T>) {
    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.#crates = options.crates ?? [];

    for (const crate of this.#crates) {
      (crate as unknown as CratePrivates<T>).setProfile(this);
    }
  }

  /**
   * Attach this profile with a sequencer
   */
  private attachSequencer(sequencer: CrateSequencer<T, any, CrateProfile<T>>) {
    this.#sequencer = sequencer;
  }

  private detachSequencer(sequencer: CrateSequencer<T, any,  CrateProfile<T>>) {
    if (this.#sequencer === sequencer) {
      this.#sequencer = undefined;
    }
  }

  get crates() {
    return this.#crates;
  }

  ensureCrateIndex(index: number) {
    return (index % this.#crates.length) || 0;
  }

  findCrateIndex(crate: Crate<T>) {
    return this.#crates.findIndex(c => c.id === crate.id);
  }

  async #alterCrates(fn: () => any) {
    if (!this.#sequencer) {
      await fn();
      return;
    }

    const oldCurrent = this.#sequencer.currentCrate;
    const savedId = oldCurrent?.id;

    await fn();

    let newIndex = this.ensureCrateIndex(this.#sequencer.getCrateIndex());

    if (savedId) {
      const found = oldCurrent ? this.findCrateIndex(oldCurrent) : -1;

      if (found !== -1) {
        newIndex = found;
      }
    }

    this.#sequencer.setCrateIndex(newIndex);
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
}


export class CrateProfileBook<P extends CrateProfile<any>> extends Library<P, string> {

}
