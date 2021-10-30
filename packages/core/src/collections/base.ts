import EventEmitter from "events";
import { castArray, isArray, reject, shuffle, uniq, uniqBy } from "lodash";
import { Track } from "../track";

export type TrackCollectionOptions<M> = {
  newTracksMapper?: (tracks: Track<M>[]) => Track<M>[];
}
export class TrackCollection<M = void> extends EventEmitter {
  protected _ready: boolean = false;

  protected tracks: Track<M>[] = [];

  constructor(protected options: TrackCollectionOptions<M>) {
    super();
    this.afterConstruct();
  }

  protected afterConstruct() {
    this.becomeReady();
  }

  protected becomeReady() {
    this._ready = true;
    this.emit('ready');
  }

  protected createTrack(path: string): Track<M> {
    return {
      path,
      collection: this
    }
  }

  get length(): number {
    return this.tracks.length;
  }

  get ready(): boolean {
    return this._ready;
  }

  shift(): Track<M> | undefined {
    return this.tracks.shift();
  }

  push(track: Track<M>): void {
    this.tracks.push(track);
  }

  add(path: string | string[]) {
    if (isArray(path)) {
      const transformFn = this.options.newTracksMapper ? this.options.newTracksMapper : (tracks: Track<M>[]) => tracks;
      const newTracks = transformFn(uniq(path).map(this.createTrack));
      this.tracks = uniqBy(this.tracks.concat(newTracks), 'path');
      return;
    }

    this.tracks.push(this.createTrack(path));
  }

  removeBy(predicate: (track: Track<M>) => boolean) {
    this.tracks = reject(this.tracks, predicate);
  }

  remove(item: string | string[]) {
    const toRemove = castArray(item);
    this.removeBy(track => toRemove.includes(track.path))
  }

  removeTrack(track: Track<M> | Track<M>[]) {
    const toRemove = castArray(track).map(track => track.path);
    this.remove(toRemove);
  }

  shuffle() {
    this.tracks = shuffle(this.tracks);
  }

  sort() {
    this.tracks.sort()
  }
}