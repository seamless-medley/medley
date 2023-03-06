import { IExciter } from "./exciter";

/**
 * An AudioDispatcher is responsible for driving audio stream from exciters
 */
export class AudioDispatcher {
  #exciters: IExciter[] = [];

  #nextTime = -1;

  #timer?: NodeJS.Timeout;

  #cycle() {
    if (this.#nextTime === -1) {
      return;
    }

    this.#nextTime += 20;

    const available = this.#exciters.filter(exciter => exciter.isPlayable);

    for (const exciter of available) {
      exciter.dispatch();
    }

    this.#prepare(available);
  }

  #prepare(exciters: IExciter[]) {
    const next = exciters.shift();

    // No exciters left to prepare
    if (!next) {
      // but still has some exciters doing their works
      if (this.#nextTime !== -1) {
        this.#timer = setTimeout(() => this.#cycle(), this.#nextTime - Date.now());
      }

      return;
    }

    next.prepare();

    // Immediately prepare the remaining exciters in the next tick
    setImmediate(() => this.#prepare(exciters));
  }

  has(player: IExciter) {
    return this.#exciters.includes(player);
  }

  add(player: IExciter) {
    if (this.has(player)) {
      return;
    }

    this.#exciters.push(player);

    if (this.#exciters.length === 1) {
      // Just added

      this.#nextTime = Date.now();
      setImmediate(() => this.#cycle());
    }
  }

  remove(player: IExciter) {
    const index = this.#exciters.indexOf(player);
    if (index === -1) {
      return;
    }

    this.#exciters.splice(index, 1);

    if (this.#exciters.length === 0) {
      this.#nextTime = -1;

      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
    }
  }
}
