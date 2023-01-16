import { createHash } from 'crypto';
import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import { castArray, chain, chunk, clamp, find, findIndex, omit, partition, random, sample, shuffle, sortBy } from "lodash";
import normalizePath from 'normalize-path';
import { createLogger } from '../logging';
import { Track } from "../track";
import { moveArrayElements, moveArrayIndexes } from '@seamless-medley/utils';

export type TrackAddingMode = 'prepend' | 'append' | 'spread';

export type TrackCreator<T extends Track<any, CE>, CE = any> = (path: string) => Promise<Omit<T, 'collection' | 'sequencing'> | undefined>;

export type TrackCollectionBasicOptions = {
  reshuffleEvery?: number;

  /**
   * How the new tracks should be added
   *
   * @default spread
   */
  newTracksAddingMode?: TrackAddingMode;

  disableLatch?: boolean;

  noFollowOnRequest?: boolean;

  auxiliary?: boolean;
}

export type TrackCollectionOptions<T extends Track<any, CE>, CE = any> = TrackCollectionBasicOptions & {
  trackCreator?: TrackCreator<T, CE>;

  /**
   * Called when new tracks are added to the collection
   */
  tracksMapper?: (tracks: T[]) => Promise<T[]>;
}

export type TrackPeek<T extends Track<any, CE>, CE = any> = {
  index: number;
  track: T;
}

export type TrackCollectionEvents = {
  ready: () => void;
  refresh: () => void;
  trackShift: (track: Track<any, any>) => void;
  trackPush: (track: Track<any, any>) => void;
  tracksAdd: (tracks: Track<any, any>[], indexes: number[]) => void;
  tracksRemove: (tracks: Track<any, any>[], indexes?: number[]) => void;
  tracksUpdate: (tracks: Track<any, any>[]) => void;
}

export const supportedExts = ['mp3', 'flac', 'wav', 'ogg', 'aiff'];

export const knownExtRegExp = new RegExp(`\\.(${supportedExts.join('|')})$`, 'i')

export class TrackCollection<T extends Track<any, CE>, CE = any> extends (EventEmitter as new () => TypedEventEmitter<TrackCollectionEvents>) {
  protected _ready: boolean = false;

  protected tracks: T[] = [];
  protected trackIdMap: Map<string, T> = new Map();

  extra!: CE extends (undefined | null) ? never : CE;

  protected logger = createLogger({
    name: `collection/${this.id}`
  });

  constructor(readonly id: string, extra: CE, public options: TrackCollectionOptions<T, CE> = {}) {
    super();
    this.extra = extra as any;
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

  protected async createTrack(path: string, generatedId: string): Promise<T> {
    const existingTrack = generatedId ? this.fromId(generatedId) : undefined;

    if (existingTrack) {
      return existingTrack;
    }

    const createdTrack = await this.options.trackCreator?.(path);

    return {
      id: createdTrack?.id ?? generatedId,
      path,
      collection: this as unknown as T['collection'],
      sequencing: {},
      ...omit(createdTrack, 'id', 'path'),
    } as T;
  }

  get length(): number {
    return this.tracks.length;
  }

  get ready(): boolean {
    return this._ready;
  }

  get latchDisabled(): boolean {
    return this.options.disableLatch === true;
  }

  private shiftCounter = 0;

  shift(): T | undefined {
    const track = this.tracks.shift();

    if (this.options.reshuffleEvery) {
      ++this.shiftCounter;

      if (this.shiftCounter >= this.options.reshuffleEvery) {
        this.logger.debug('Re-shuffle', this.options.reshuffleEvery);

        this.shiftCounter = 0;
        this.shuffle();
        return track;
      }
    }

    if (track) {
      this.trackIdMap.delete(track.id);
      this.emit('trackShift', track);
    }

    return track;
  }

  push(track: T): number {
    if (track) {
      this.trackIdMap.set(track.id, track);
      this.emit('trackPush', track);
      return this.tracks.push(track) - 1;
    }

    return -1;
  }

  static isKnownFileExtension(filename: string) {
    return knownExtRegExp.test(filename);
  }

  private async transform(paths: string[], fn: (tracks: T[]) => Promise<any>) {
    const validPaths = chain(paths)
      .castArray()
      .map(p => normalizePath(p))
      .filter(TrackCollection.isKnownFileExtension)
      .uniq()
      .value();

    const immediateTracks: T[] = [];

    for (const group of chunk(validPaths, 500)) {
      const created = await Promise.all(group.map(async p => await this.createTrack(p, await this.getTrackId(p))));
      await fn(created);
      immediateTracks.push(...created);
    }

    return immediateTracks;
  }

  async add(paths: string[], mode?: TrackAddingMode): Promise<T[]> {
    return this.transform(paths, async created => this.addTracks(created, mode));
  }

  private async addTracks(tracks: T[], mode?: TrackAddingMode) {
    const { tracksMapper } = this.options;

    const newTracks = tracks.filter(it => !this.trackIdMap.has(it.id));
    const mapped = await tracksMapper?.(newTracks) ?? newTracks;

    if (!mapped.length) {
      return;
    }

    switch (mode ?? this.options.newTracksAddingMode ?? 'spread') {
      case 'append':
        this.tracks.push(...mapped);
        break;

      case 'prepend':
        this.tracks.unshift(...mapped);
        break;

      case 'spread':
        {
          let index = 0;

          for (const track of mapped) {
            const width = Math.ceil(this.tracks.length / mapped.length) + 1;
            index = clamp(random(index, index + width), 0, this.tracks.length - 1);
            this.tracks.splice(index, 0, track);
          }
        }
        break;
    }

    for (const track of mapped) {
      this.trackIdMap.set(track.id, track);
    }

    const indexes = mapped.map(t => this.indexOf(t));
    this.logger.debug('New tracks added', mapped.length);
    this.emit('tracksAdd', mapped, indexes);
  }

  async update(paths: string[]) {
    return this.transform(paths, async updated => {
      this.logger.debug('Track updated', updated.length);
      this.emit('tracksUpdate', updated);
    });
  }

  clear() {
    this.emit('tracksRemove', this.tracks);

    this.tracks = [];
    this.trackIdMap.clear();
  }

  removeBy(predicate: (track: T) => boolean): T[] {
    const snapshot = this.all();

    const [removed, remaining] = partition(this.tracks, predicate);
    this.tracks = remaining;

    for (const { id } of removed) {
      this.trackIdMap.delete(id);
    }

    const indexes = removed.map(t => snapshot.findIndex(st => st.id == t.id));

    this.emit('tracksRemove', removed, indexes);

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

  move(newPosition: number, indexes: number[]) {
    moveArrayIndexes(this.tracks, newPosition, ...indexes);
  }

  moveTrack(newPosition: number, tracks: T | T[]) {
    moveArrayElements(this.tracks, newPosition, ...castArray(tracks));
  }

  moveByPath(newPosition: number, paths: string | string[]) {
    const toMove = castArray(paths).map(path => this.find(path));
    moveArrayElements(this.tracks, newPosition, ...toMove);
  }

  async shuffle() {
    await this.shuffleBy(shuffle);
  }

  async shuffleBy(fn: (tracks: T[]) => T[] | Promise<T[]>) {
    this.tracks = await fn(this.tracks);
    this.emit('refresh');
  }

  sort(...sortFn: ((track: T) => unknown)[]) {
    if (!sortFn.length) {
      sortFn = [track => track.path];
    }

    this.tracks = sortBy(this.tracks, ...sortFn);
    this.emit('refresh');
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

  all(): T[] {
    return [...this.tracks];
  }
}
