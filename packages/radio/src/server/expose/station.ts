import { Station } from "@seamless-medley/core";
import { $Exposing, Exposable } from "../../socket/expose";
import { Station as RemoteStation } from "../../socket/remote/station";

export class ExposedStation implements Exposable<RemoteStation> {
  [$Exposing]: Station;

  constructor(station: Station) {
    super();
    this[$Exposing] = station;


  get #exposed() {
    return this[$Exposing];
  }
  }

  get playing() {
    return this.#exposed.playing;
  }

  get paused() {
    return this.#exposed.paused;
  }

  get playState(): PlayState {
    return this.#exposed.playState;
  }

  async start() {
    this.#exposed.start();
  }

  async pause() {
    this.#exposed.pause();
  }

  async skip() {
    return this.#exposed.skip();
  }
};
