import { createHash } from 'crypto';
import EventEmitter from "events";
import { castArray, chain, chunk, find, findIndex, partition, reject, sample, shuffle, sortBy, uniqBy } from "lodash";
import normalize from 'normalize-path';
import { Track } from "../track";

export type TrackCollectionOptions<T extends Track<any>> = {
  // TODO: Option to initialize the collection with the specified list of files
  tracksMapper?: (tracks: T[]) => T[] | Promise<T[]>;
}

export type TrackPeek<T extends Track<any>> = {
  index: number;
  track: T;
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
    const id = createHash('md5').update(normalize(path)).digest('base64');

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
    const track = this.tracks.shift();
    if (track) {
      this.trackIdMap.delete(track.id);
    }
    return track;
  }

  push(track: T): number {
    if (track) {
      this.trackIdMap.set(track.id, track);
      return this.tracks.push(track) - 1;
    }

    return -1;
  }

  async add(paths: string | string[]): Promise<void> {
    const immediateTracks = await Promise.all(chain(paths)
      .castArray()
      .filter(p => /\.(mp3|flac|wav|ogg|aiff)$/i.test(p))
      .uniq().map(p => this.createTrack(p))
      .value()
    );

    await this.addTracks(immediateTracks);
  }

  private async addTracks(tracks: T[]): Promise<T[]> {
    const { tracksMapper } = this.options;

    const fresh = reject(tracks, it => this.trackIdMap.has(it.id));
    const newTracks = tracksMapper ? await tracksMapper(fresh) : fresh;

    if (newTracks.length) {
      for (const track of newTracks) {
        this.trackIdMap.set(track.id, track);
      }

      this.tracks = uniqBy(this.tracks.concat(newTracks), 'id');

      return newTracks;
    }

    return [];
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

  async shuffle() {
    await this.shuffleBy(shuffle);
  }

  async shuffleBy(fn: (tracks: T[]) => T[] | Promise<T[]>) {
    this.tracks = await fn(this.tracks)
  }

  sort(...sortFn: ((track: T) => unknown)[]) {
    if (!sortFn.length) {
      sortFn = [track => track.path];
    }

    this.tracks = sortBy(this.tracks, ...sortFn);
  }

  indexOf(track: T): number {
    return findIndex(this.tracks, t => t.id === track.id);
  }

  find(path: string) {
    return find(this.tracks, track => track.path === path);
  }

  fromId(id: string): T | undefined {
    return this.trackIdMap.get(id);
  }

  sample(): T | undefined {
    return sample(this.tracks);
  }

  peek(from: number = 0, n: number): TrackPeek<T>[] {
    const max = this.tracks.length - 1;
    const sib = Math.floor((n - 1) / 2);

    let left = from - sib;
    let right = from + sib;

    if (left <= 0) {
      left = 0;
      right = Math.min(max, n - 1);
    } else if (right >= max) {
      right = max;
      left = Math.max(0, right - n + 1);
    }

    return this.tracks.slice(left, right + 1).map((track, i) => ({
      index: left + i,
      track
    }))
  }
}