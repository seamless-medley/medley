import { DeckIndex, DeckPositions, PlayState, Station, StationEvents } from "@seamless-medley/core";
import { $Exposing, Exposable } from "../../../socket/expose";
import { DeckInfoWithPositions, fromDeckInfoWithPositions } from "../../../remotes/core/po/deck";
import { Station as RemoteStation } from "../../../remotes/core";
import { MixinEventEmitterOf } from "../../../socket/types";

export class ExposedStation extends MixinEventEmitterOf<RemoteStation>() implements Exposable<RemoteStation> {
  [$Exposing]: Station;

  constructor(station: Station) {
    super();
    this[$Exposing] = station;

    this.#station.on('deckLoaded', this.#onDeckLoaded);
    this.#station.on('deckUnloaded', this.#onDeckUnloaded);
    this.#station.on('deckStarted', this.#onDeckStarted);
    this.#station.on('deckActive', this.#onDeckActive);
    this.#station.on('collectionChange', this.#onCollectionChange);
    this.#station.on('crateChange', this.#onCrateChange);
  }

  dispose() {
    this.#station.off('deckLoaded', this.#onDeckLoaded);
    this.#station.off('deckUnloaded', this.#onDeckUnloaded);
    this.#station.off('deckStarted', this.#onDeckStarted);
    this.#station.off('deckActive', this.#onDeckActive);
    this.#station.off('collectionChange', this.#onCollectionChange);
  }

  get #station() {
    return this[$Exposing];
  }

  #prefixWithStationId(s: string) {
    return `${this.id}/${s}`
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

  #onCollectionChange: StationEvents['collectionChange'] = (prevCollection, newCollection, fromRequestTrack) => {
    this.emit(
      'collectionChange',
      prevCollection ? this.#prefixWithStationId(prevCollection.id) : undefined,
      this.#prefixWithStationId(newCollection.id),
      fromRequestTrack
    );
  }

  #onCrateChange: StationEvents['crateChange'] = (oldCrate, newCrate) => {
    this.emit('crateChange', oldCrate?.id, newCrate.id);
  }

  get id() {
    return this.#station.id;
  }

  get name() {
    return this.#station.name;
  }

  set name(v) {
    this.#station.name = v;
  }

  get description() {
    return this.#station.description;
  }

  set description(v) {
    this.#station.description = v;
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

  get activeDeck() {
    return this.#station.activeDeck;
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

  getCurrentCollection() {
    const id = this.#station.trackPlay?.track?.collection?.id
    return id ? this.#prefixWithStationId(id) : undefined;
  }

  getCollections() {
    return this.#station.collections.map(c => this.#prefixWithStationId(c.id));
  }
};
