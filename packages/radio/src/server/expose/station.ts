import { BoomBoxTrackPlay, PlayState, Station } from "@seamless-medley/core";
import { $Exposing, Exposable } from "../../socket/expose";
import { fromBoomBoxTrackPlay } from "../../socket/po/track";
import { Station as RemoteStation } from "../../socket/remote/station";
import { MixinEventEmitterOf } from "../../socket/types";

export class ExposedStation extends MixinEventEmitterOf<RemoteStation>() implements Exposable<RemoteStation>  {
  [$Exposing]: Station;

  constructor(station: Station) {
    super();
    this[$Exposing] = station;

    this.#exposed.on('trackStarted', this.#onTrackStarted);
  }

  dispose() {
    this.#exposed.off('trackStarted', this.#onTrackStarted);
  }

  get #exposed() {
    return this[$Exposing];
  }

  // TODO: Should inform a new observer about current state of all decks

  #onTrackStarted = async (deckIndex: number, trackPlay: BoomBoxTrackPlay) => {
    const x = await fromBoomBoxTrackPlay(trackPlay);
    console.log('Emitting', x);
    this.emit('trackStarted', deckIndex, x);
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
