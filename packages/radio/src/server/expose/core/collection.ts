import { MusicTrackCollection, MusicTrackCollectionEvents, Station } from "@seamless-medley/core";
import { isFunction, isObject, omitBy } from "lodash";
import { $Exposing, Exposable } from "../../../socket/expose";
import { toTrack } from "../../../remotes/core/po/track";
import { Collection } from "../../../remotes/core/collection";
import { MixinEventEmitterOf } from "../../../socket/types";

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

  #onRefresh: MusicTrackCollectionEvents<Station>['refresh'] = () => {
    this.emit('refresh');
  }

  #onTracksShift: MusicTrackCollectionEvents<Station>['trackShift'] = async (track) => {
    this.emit('trackShift', await toTrack(track, true));
  }

  #onTracksPush: MusicTrackCollectionEvents<Station>['trackPush'] = async (track) => {
    this.emit('trackPush', await toTrack(track, true));
  }

  #onTracksAdd: MusicTrackCollectionEvents<Station>['tracksAdd'] = async (tracks, indexes) => {
    this.emit('tracksAdd',
      await Promise.all(tracks.map(t => toTrack(t, true))),
      indexes
    );
  }

  #onTracksRemove: MusicTrackCollectionEvents<Station>['tracksRemove'] = async (tracks, indexes) => {
    this.emit('tracksRemove',
      await Promise.all(tracks.map(t => toTrack(t, true))),
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
    return Promise.all(this.#collection.all().map(t => toTrack(t, true)));
  }
}
