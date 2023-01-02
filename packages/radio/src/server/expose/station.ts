import { Station } from "@seamless-medley/core";
import { $Exposing, Exposable } from "../../socket/expose";
import { Station as RemoteStation } from "../../socket/remote/station";

export class ExposedStation implements Exposable<RemoteStation> {
  [$Exposing] = true as const;

  #station: Station;

  constructor(station: Station) {
    console.log('ExposedStation constructor')
    this.#station = station;
  }

  get playing() {
    return this.#station.playing;
  }

  get paused() {
    return this.#station.paused;
  }

  get playState() {
    return this.#station.playState;
  }

  start(): void {
    this.#station.start();
  }

  pause() {
    this.#station.pause();
  }
  skip() {
    return this.#station.skip();
  }
};
