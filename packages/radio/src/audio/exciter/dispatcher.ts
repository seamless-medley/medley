import { IExciter } from "./exciter";

/**
 * Encapsulated methods used internally by IExciter itself
 */
export interface DispatcherPrivate {
  add(exciter: IExciter): void;
  remove(exciter: IExciter): void;
}

/**
 * An AudioDispatcher is responsible for driving audio stream from exciters
 */
export class AudioDispatcher {
  #exciters: IExciter[] = [];

  #nextTime = -1;

  #timer?: NodeJS.Timeout;

  #cycle = () => {
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

    if (next) {
      next.prepare();

      // Immediately prepare the remaining exciters in the next tick
      setImmediate(() => this.#prepare(exciters));
      return;
    }

    // No exciters left to prepare
    // schedule next cycle
    if (this.#nextTime !== -1) {
      this.#timer = setTimeout(this.#cycle, Math.max(0, this.#nextTime - performance.now()));
    }
  }

  has(exciter: IExciter) {
    return this.#exciters.includes(exciter);
  }

  clear() {
    this.#exciters = [];
  }

  protected add(exciter: IExciter) {
    if (this.has(exciter)) {
      return;
    }

    this.#exciters.push(exciter);

    if (this.#exciters.length === 1) {
      // Just added

      this.#nextTime = performance.now();
      setImmediate(this.#cycle);
    }
  }

  protected remove(exciter: IExciter) {
    const index = this.#exciters.indexOf(exciter);
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
