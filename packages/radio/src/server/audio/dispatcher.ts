export interface IPlayer {
  isPlayable(): boolean;
  prepare(): void;
  dispatch(): void;
}

export class AudioDispatcher {
  #players: IPlayer[] = [];

  #nextTime = -1;

  #timer?: NodeJS.Timeout;

  #cycle() {
    if (this.#nextTime === -1) {
      return;
    }

    this.#nextTime += 20;

    const available = this.#players.filter(player => player.isPlayable());

    for (const player of available) {
      player.dispatch();
    }

    this.#prepare(available);
  }

  #prepare(players: IPlayer[]) {
    const nextPlayer = players.shift();

    // No players left to prepare
    if (!nextPlayer) {
      // but still has some players doing their works
      if (this.#nextTime !== -1) {
        this.#timer = setTimeout(() => this.#cycle(), this.#nextTime - Date.now());
      }

      return;
    }

    nextPlayer.prepare();

    // Immediately prepare the remaining players in the next tick
    setImmediate(() => this.#prepare(players));
  }

  has(player: IPlayer) {
    return this.#players.includes(player);
  }

  add(player: IPlayer) {
    if (this.has(player)) {
      return;
    }

    this.#players.push(player);

    if (this.#players.length === 1) {
      // Just added

      this.#nextTime = Date.now();
      setImmediate(() => this.#cycle());
    }
  }

  remove(player: IPlayer) {
    const index = this.#players.indexOf(player);
    if (index === -1) {
      return;
    }

    this.#players.splice(index, 1);

    if (this.#players.length === 0) {
      this.#nextTime = -1;

      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
    }
  }
}
