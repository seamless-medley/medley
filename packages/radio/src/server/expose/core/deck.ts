import { Writable } from "type-fest";
import { DeckIndex, DeckPositions, Station, StationEvents } from "@seamless-medley/core";
import { $Exposing, Exposable } from "../../../socket";
import { fromDeckInfoWithPositions } from "../../../remotes";
import type { Deck, DeckInfoWithPositions,  } from "../../../remotes";

export class ExposedDeck implements Exposable<Deck> {
  [$Exposing]:  Writable<Deck> = {
    active: false,
    playing: false,
    cp: 0,
    duration: 0,
    first: 0,
    last: 0,
    leading: 0,
    trailing: 0,
    cuePoint: 0,
    transitionStart: 0,
    transitionEnd: 0,
    trackPlay: (() => undefined) as any // A fake getter, just to force register this virtual object
  };

  constructor(station: Station, deckIndex: DeckIndex) {
    this.#station = station;
    this.#deckIndex = deckIndex;

    this.#station.on('deckLoaded', this.#onDeckLoaded);
    this.#station.on('deckUnloaded', this.#onDeckUnloaded);
    this.#station.on('deckStarted', this.#onDeckStarted);
    this.#station.on('deckActive', this.#onDeckActive);

    this.getDeckInfo().then(info => this.#update(info));

    this.#timer = setInterval(() => this.#updatePositions(this.#station.getDeckPositions(this.#deckIndex)), 1000 / 30);
  }

  dispose() {
    clearInterval(this.#timer);

    this.#station.off('deckLoaded', this.#onDeckLoaded);
    this.#station.off('deckUnloaded', this.#onDeckUnloaded);
    this.#station.off('deckStarted', this.#onDeckStarted);
    this.#station.off('deckActive', this.#onDeckActive);
  }

  #station: Station;

  #deckIndex: DeckIndex;

  #timer: NodeJS.Timeout;

  get #deck() {
    return this[$Exposing];
  }

  get active() {
    return this.#deck.active;
  }

  get playing() {
    return this.#deck.playing;
  }

  get cp() {
    return this.#deck.cp;
  }

  get trackPlay() {
    return this.#deck.trackPlay;
  }

  get duration() {
    return this.#deck.duration;
  }

  get first() {
    return this.#deck.first;
  }

  get last() {
    return this.#deck.last;
  }

  get leading() {
    return this.#deck.leading;
  }

  get trailing() {
    return this.#deck.trailing;
  }

  get cuePoint() {
    return this.#deck.cuePoint;
  }

  get transitionStart() {
    return this.#deck.transitionStart;
  }

  get transitionEnd() {
    return this.#deck.transitionEnd;
  }

  #update(info: DeckInfoWithPositions) {
    const { active, playing, positions, trackPlay } = info;

    this.#deck.active = active;
    this.#deck.playing = playing;
    this.#deck.trackPlay = trackPlay;

    this.#updatePositions(positions);
  }

  #updatePositions(positions: DeckPositions) {
    this.#deck.cp = positions.current ?? 0;
    this.#deck.duration = positions.duration;
    this.#deck.first = positions.first;
    this.#deck.last = positions.last;
    this.#deck.leading = positions.leading;
    this.#deck.trailing = positions.trailing;
    this.#deck.cuePoint = positions.cuePoint;
    this.#deck.transitionStart = positions.transitionStart;
    this.#deck.transitionEnd = positions.transitionEnd;
  }

  #onDeckLoaded: StationEvents['deckLoaded'] = async (deckIndex: number) => {
    if (deckIndex === this.#deckIndex) {
      this.#update(await this.getDeckInfo());
    }
  }

  #onDeckUnloaded: StationEvents['deckUnloaded'] = async (deckIndex: number) => {
    if (deckIndex === this.#deckIndex) {
      this.#update(await this.getDeckInfo());
    }
  }

  #onDeckStarted: StationEvents['deckStarted'] = async (deckIndex: number) => {
    if (deckIndex === this.#deckIndex) {
      this.#update(await this.getDeckInfo());
    }
  }

  #onDeckActive: StationEvents['deckActive'] = async (deckIndex) => {
    if (deckIndex === this.#deckIndex) {
      this.#update(await this.getDeckInfo());
    }
  }

  getDeckInfo(): Promise<DeckInfoWithPositions> {
    return fromDeckInfoWithPositions(
      this.#station.getDeckInfo(this.#deckIndex)
    )
  }
}
