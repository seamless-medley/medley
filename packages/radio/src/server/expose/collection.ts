import { BoomBoxTrack, MusicTrackCollection, Station, TrackCollectionEvents } from "@seamless-medley/core";
import { isFunction, isObject, omit, omitBy } from "lodash";
import { $Exposing, Exposable } from "../../socket/expose";
import { fromBoomBoxTrack } from "../../socket/po/track";
import { Collection } from "../../socket/remote/collection";
import { MixinEventEmitterOf } from "../../socket/types";

export class ExposedColection extends MixinEventEmitterOf<Collection>() implements Exposable<Collection> {
  [$Exposing]: MusicTrackCollection<Station>;

  constructor(collection: MusicTrackCollection<Station>) {
    super();

    this[$Exposing] = collection;

    this.#collection.on('refresh', this.#onRefresh);
    this.#collection.on('trackShift', this.#onTracksShift);
    this.#collection.on('trackPush', this.#onTracksPush);
    this.#collection.on('tracksAdd', this.#onTracksAdd);
    this.#collection.on('tracksRemove', this.#onTracksRemove);
  }

  dispose() {
    this.#collection.off('refresh', this.#onRefresh);
    this.#collection.off('trackShift', this.#onTracksShift);
    this.#collection.off('trackPush', this.#onTracksPush);
    this.#collection.off('tracksAdd', this.#onTracksAdd);
    this.#collection.off('tracksRemove', this.#onTracksRemove);
  }

  get #collection() {
    return this[$Exposing];
  }

  #onRefresh: TrackCollectionEvents['refresh'] = () => {
    this.emit('refresh');
  }

  #onTracksShift: TrackCollectionEvents['trackShift'] = async (track) => {
    this.emit('trackShift', await fromBoomBoxTrack(track, true));
  }

  #onTracksPush: TrackCollectionEvents['trackPush'] = async (track) => {
    this.emit('trackPush', await fromBoomBoxTrack(track, true));
  }

  #onTracksAdd: TrackCollectionEvents['tracksAdd'] = async (tracks, indexes) => {
    this.emit('tracksAdd',
      await Promise.all(tracks.map(t => fromBoomBoxTrack(t, true))),
      indexes
    );
  }

  #onTracksRemove: TrackCollectionEvents['tracksRemove'] = async (tracks, indexes) => {
    this.emit('tracksRemove',
      await Promise.all(tracks.map(t => fromBoomBoxTrack(t, true))),
      indexes
    );
  }

  get id() {
    const { owner: station } = this.#collection.extra;
    return `${station.id}/${this.#collection.id}`;
  }

  get description() {
    return this.#collection.extra.description;
  }

  get options() {
    return omitBy(this.#collection.options, v => isObject(v) || isFunction(v));
  }

  get length() {
    return this.#collection.length;
  }

  get ready() {
    return this.#collection.ready;
  }

  clear() {
    this.#collection.clear();
  }

  shuffle() {
    this.#collection.shuffle();
  }

  async all() {
    return Promise.all(this.#collection.all().map(t => fromBoomBoxTrack(t, true)));
  }
}
