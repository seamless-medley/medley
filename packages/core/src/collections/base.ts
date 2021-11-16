import EventEmitter from "events";
import { createHash } from 'crypto';
import _, { castArray, partition, reject, sample, shuffle, uniqBy } from "lodash";
import { Track } from "../track";

export type TrackCollectionOptions<T extends Track<any>> = {
  newTracksMapper?: (tracks: T[]) => T[] | Promise<T[]>;
}

export class TrackCollection<T extends Track<any>> extends EventEmitter {
  protected _ready: boolean = false;

  protected tracks: T[] = [];
  protected trackIdMap: Map<string, T> = new Map();

  constructor(readonly id: string, protected options: TrackCollectionOptions<T> = {}) {
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

  protected async createTrack(path: string): Promise<T> {
    const id = createHash('md5').update(path).digest('base64');

    return {
      id,
      path,
      collection: this
    } as unknown as T;
  }

  get length(): number {
    return this.tracks.length;
  }

  get ready(): boolean {
    return this._ready;
  }

  shift(): T | undefined {
    return this.tracks.shift();
  }

  push(track: T): void {
    this.tracks.push(track);
  }

  async add(path: string | string[]) {
    const tracks = await Promise.all(
      _(path).castArray()
      .uniq().map(p => this.createTrack(p))
      .value()
    );

    const { newTracksMapper } = this.options;
    const newTracks = newTracksMapper ? await newTracksMapper(tracks) : tracks;

    for (const track of newTracks) {
      this.trackIdMap.set(track.id, track);
    }

    this.tracks = uniqBy(this.tracks.concat(newTracks), 'path');
  }

  removeBy(predicate: (track: T) => boolean) {
    const [removed, rejected] = partition(this.tracks, predicate);
    this.tracks = rejected;

    for (const { id } of removed) {
      this.trackIdMap.delete(id);
    }
  }

  remove(item: string | string[]) {
    const toRemove = castArray(item);
    this.removeBy(track => toRemove.includes(track.path));
  }

  removeTrack(track: T |T[]) {
    const toRemove = castArray(track).map(track => track.path);
    this.remove(toRemove);
  }

  shuffle() {
    this.tracks = shuffle(this.tracks);
  }

  sort(...sortFn: ((track: T) => unknown)[]) {
    if (!sortFn.length) {
      sortFn = [track => track.path];
    }

    this.tracks = _.sortBy(this.tracks, ...sortFn);
  }

  find(path: string) {
    return _.find(this.tracks, track => track.path === path);
  }

  fromId(id: string): T | undefined {
    return this.trackIdMap.get(id);
  }

  sample(): T | undefined {
    return sample(this.tracks);
  }
}