import { DeckIndex, DeckPositions, PlayState, Station, StationEvents } from "@seamless-medley/core";
import { every } from "lodash";
import { equals } from "lodash/fp";
import { $Exposing, Exposable } from "../../socket/expose";
import { DeckInfoWithPositions, fromDeckInfoWithPositions } from "../../socket/po/deck";
import { Station as RemoteStation } from "../../socket/remote";
import { MixinEventEmitterOf } from "../../socket/types";

export class ExposedStation extends MixinEventEmitterOf<RemoteStation>() implements Exposable<RemoteStation>  {
  [$Exposing]: Station;

  constructor(station: Station) {
    super();
    this[$Exposing] = station;

    this.#station.on('deckLoaded', this.#onDeckLoaded);
    this.#station.on('deckUnloaded', this.#onDeckUnloaded);
    this.#station.on('deckStarted', this.#onDeckStarted);
    this.#station.on('deckActive', this.#onDeckActive);

    this.#audiLevelTimer = setInterval(this.#audioLevelDispatcher, 1000 / 60);
  }

  dispose() {
    this.#station.off('deckLoaded', this.#onDeckLoaded);
    this.#station.off('deckUnloaded', this.#onDeckUnloaded);
    this.#station.off('deckStarted', this.#onDeckStarted);
    this.#station.off('deckActive', this.#onDeckActive);

    clearInterval(this.#audiLevelTimer);
  }

  get #station() {
    return this[$Exposing];
  }

  #audiLevelTimer: NodeJS.Timer;

  #audioLevelDispatcher = () => {
    const { audioLevels: { left, right, reduction } } = this.#station;

    const values = [
      left.magnitude, left.peak,
      right.magnitude, right.peak,
      reduction
    ];

    const isSilence = every(values, equals(0));

    const buffer = !isSilence ? Buffer.alloc(values.length * 8) : undefined;

    if (buffer) {
      for (const [index, value] of values.entries()) {
        buffer.writeDoubleLE(value, index * 8);
      }
    }

    this.emit('audioLevels', buffer);
  }

  #onDeckLoaded: StationEvents['deckLoaded'] = async (deckIndex: number) => {
    const info = await this.getDeckInfo(deckIndex);
    this.emit('deckLoaded', deckIndex, info);
  }

  #onDeckUnloaded: StationEvents['deckUnloaded'] = async (deckIndex: number) => {
    this.emit('deckUnloaded', deckIndex);
  }

  #onDeckStarted: StationEvents['deckStarted'] = async (deckIndex: number) => {
    const { positions } = await this.getDeckInfo(deckIndex);
    this.emit('deckStarted', deckIndex, positions);
  }

  #onDeckActive: StationEvents['deckActive'] = async (deckIndex) => {
    const { positions } = await this.getDeckInfo(deckIndex);
    this.emit('deckActive', deckIndex, positions);
  }

  get id() {
    return this.#station.id;
  }

  get name() {
    return this.#station.name;
  }

  get description() {
    return this.#station.description;
  }

  get playing() {
    return this.#station.playing;
  }

  get paused() {
    return this.#station.paused;
  }

  get playState(): PlayState {
    return this.#station.playState;
  }

  async start() {
    this.#station.start();
  }

  async pause() {
    this.#station.pause();
  }

  async skip() {
    return this.#station.skip();
  }

  getDeckPositions(deckIndex: DeckIndex): DeckPositions {
    return this.#station.getDeckPositions(deckIndex)
  }

  getDeckInfo(deckIndex: DeckIndex): Promise<DeckInfoWithPositions> {
    return fromDeckInfoWithPositions(
      this.#station.getDeckInfo(deckIndex)
    )
  }

  getCollections(): string[] {
    return this.#station.collections.map(c => `${this.id}/${c.id}`);
  }
};
