import { chain, isString } from "lodash";
import { Track } from "../track";
import { Crate } from "./base";
import { CrateSequencer } from "./sequencer";
import { moveArrayIndexes } from "@seamless-medley/utils";
import { Library } from "../library";

export class CrateProfile<T extends Track<any>> {
  #crates: Array<Crate<T>>;

  #sequencer?: CrateSequencer<T, any>;

  constructor(readonly id: string, crates?: Array<Crate<T>>) {
    this.#crates = crates ?? [];
  }

  /**
   * Attach this profile with a sequencer
   */
  private attachSequencer(sequencer: CrateSequencer<T, any>) {
    this.#sequencer = sequencer;
  }

  private detachSequencer(sequencer: CrateSequencer<T, any>) {
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
