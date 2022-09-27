import { createHash } from 'crypto';
import EventEmitter from "events";
import { castArray, chain, chunk, find, findIndex, omit, partition, sample, shuffle, sortBy } from "lodash";
import normalizePath from 'normalize-path';
import { createLogger } from '../logging';
import { Track } from "../track";
import { moveArrayElements } from '../utils';

export type TrackCreator<T extends Track<any, any>> = (path: string) => Promise<Omit<T, 'collection'> | undefined>;

export type TrackCollectionOptions<T extends Track<any, CE>, CE = never> = {
  trackCreator?: TrackCreator<T>;

  /**
   * Called when new tracks are added to the collection
   */
  tracksMapper?: (tracks: T[]) => Promise<T[]>;

  reshuffleEvery?: number;

  /**
   * How the new tracks should be added
   *
   * @default append
   */
  newTracksAddingMode?: 'prepend' | 'append';
}

export type TrackPeek<T extends Track<any, CE>, CE = never> = {
  index: number;
  track: T;
}
export class TrackCollection<T extends Track<any, CE>, CE = never> extends EventEmitter {
  protected _ready: boolean = false;

  protected tracks: T[] = [];
  protected trackIdMap: Map<string, T> = new Map();

  extra?: CE;

  protected logger = createLogger({
    name: `collection/${this.id}`
  });

  constructor(readonly id: string, public options: TrackCollectionOptions<T, CE> = {}) {
    super();
    this.afterConstruct();
  }

  protected afterConstruct() {
    this.becomeReady();
  }

  protected becomeReady() {
    if (!this._ready) {
      this._ready = true;
      this.emit('ready');
    }
  }

  protected async getTrackId(path: string): Promise<string> {
    return createHash('md5').update(normalizePath(path)).digest('base64');
  }

  protected async createTrack(path: string): Promise<T> {
    const { trackCreator } = this.options;

    const createdTrack = await trackCreator?.(path);

    type NT = Track<any, CE>;
    type MutableTrack = { -readonly [P in keyof NT]: NT[P] };

    const track: MutableTrack = {
      id: createdTrack?.id ?? await this.getTrackId(path),
      path,
      collection: this as any,
      ...omit(createdTrack, 'id', 'path'),
    };

    return track as T;
  }

  get length(): number {
    return this.tracks.length;
  }

  get ready(): boolean {
    return this._ready;
  }

  private shiftCounter = 0;

  shift(): T | undefined {
    const track = this.tracks.shift();

    if (track) {
      this.trackIdMap.delete(track.id);
    }

    if (this.options.reshuffleEvery) {
      ++this.shiftCounter;

      if (this.shiftCounter >= this.options.reshuffleEvery) {
        this.logger.debug('Re-shuffle', this.options.reshuffleEvery);

        this.shiftCounter = 0;
        this.tracks = shuffle(this.tracks);
      }
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

  async add(paths: string | string[]): Promise<T[]> {
    const validPaths = chain(paths)
      .castArray()
      .map(p => normalizePath(p))
      .filter(p => /\.(mp3|flac|wav|ogg|aiff)$/i.test(p))
      .uniq()
      .value();

    const immediateTracks: T[] = [];

    for (const group of chunk(validPaths, 500)) {
      const created = await Promise.all(group.map(p => this.createTrack(p)));
      await this.addTracks(created);
      immediateTracks.push(...created);
    }

    return immediateTracks;
  }

  private async addTracks(tracks: T[]) {
    const { tracksMapper } = this.options;

    const [updatingTracks, freshTracks] = partition(tracks, it => this.trackIdMap.has(it.id));
    const freshTracksMapped = await tracksMapper?.(freshTracks) ?? freshTracks;

    if (freshTracksMapped.length) {
      const [a, b] = (this.options.newTracksAddingMode === 'prepend') ? [freshTracksMapped, this.tracks] : [this.tracks, freshTracksMapped];

      this.tracks = a.concat(b);

      for (const track of freshTracksMapped) {
        this.trackIdMap.set(track.id, track);
      }

      this.emit('tracksAdd', freshTracksMapped);
    }

    if (updatingTracks.length) {
      this.emit('tracksUpdate', updatingTracks);
    }
  }

  removeBy(predicate: (track: T) => boolean): T[] {
    const [removed, remaining] = partition(this.tracks, predicate);
    this.tracks = remaining;

    for (const { id, path } of removed) {
      this.trackIdMap.delete(id);
    }

    this.emit('tracksRemove', removed);

    return removed;
  }

  async remove(paths: string | string[]): Promise<T[]> {
    const toRemove = await Promise.all(castArray(paths).map(path => this.getTrackId(path)));
    return this.removeBy(track => toRemove.includes(track.id));
  }

  async removeTrack(tracks: T | T[]): Promise<T[]> {
    const toRemove = castArray(tracks).map(track => track.path);
    return this.remove(toRemove);
  }

  async moveTrack(newPosition: number, tracks: T | T[]) {
    moveArrayElements(this.tracks, newPosition, ...castArray(tracks));
  }

  async move(newPosition: number, paths: string | string[]) {
    const toMove = await Promise.all(castArray(paths)
      .map(path => this.getTrackId(path)))
      .then(ids => ids.map(id => this.trackIdMap.get(id))
    );

    moveArrayElements(this.tracks, newPosition, ...toMove);
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

  at(index: number): T {
    return this.tracks[index];
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

  peek(from: number = 0, n: number): TrackPeek<T, CE>[] {
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
    }));
  }

  [Symbol.iterator](): Iterator<T, any, undefined> {
    return this.tracks.values();
  }

  all(): ReadonlyArray<T> {
    return [...this.tracks];
  }
}
