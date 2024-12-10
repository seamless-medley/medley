import os from 'node:os';
import { stat } from 'node:fs/promises';
import { createHash } from 'crypto';
import { TypedEmitter } from "tiny-typed-emitter";
import { castArray, chain, chunk, clamp, omit, partition, random, sample, shuffle, sortBy, zip } from "lodash";
import normalizePath from 'normalize-path';
import { Logger, createLogger } from '@seamless-medley/logging';
import { moveArrayElements, moveArrayIndexes, waitFor } from '@seamless-medley/utils';
import { Track, TrackExtra, TrackExtraOf } from "../track";

export type TrackAddingMode = 'prepend' | 'append' | 'spread';

export type TrackCreator<T extends Track<any>> = (path: string) => Promise<Omit<T, 'id' | 'collection' | 'sequencing'> & { id?: string } | undefined>;

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

  logPrefix?: string;
}

export type TrackCollectionOptions<T extends Track<any>> = TrackCollectionBasicOptions & {
  trackCreator?: TrackCreator<T>;

  /**
   * Called when new tracks are added to the collection
   */
  tracksMapper?: (tracks: T[]) => Promise<T[]>;
}

export type TrackIndex<T extends Track<any>> = {
  index: number;
  track: T;
}

export type TrackPeek<T extends Track<any>> = TrackIndex<T> & {
  localIndex: number;
}

export type TracksUpdateEvent<T extends Track<any>> = {
  tracks: Array<T>;
  updatedTracks: Array<T>;
  promises: Array<Promise<any>>;
}

export type TrackCollectionEvents<T extends Track<any>> = {
  ready: () => void;
  refresh: () => void;
  trackShift: (track: T) => void;
  trackPush: (track: T) => void;
  tracksAdd: (tracks: T[], chunkIndex: number, totalChunks: number) => void;
  tracksRemove: (tracks: T[]) => void;
  tracksUpdate: (event: TracksUpdateEvent<T>) => void;
}

export const supportedExts = ['mp3', 'flac', 'wav', 'ogg', 'aiff'];

export const knownExtRegExp = new RegExp(`\\.(${supportedExts.join('|')})$`, 'i');

export type ChunkHandler<T> = (chunk: T[], chunkIndex: number, totalChunks: number) => Promise<T[]>;

export class TrackCollection<
  T extends Track<TE>,
  TE extends TrackExtra = TrackExtraOf<T>,
  Extra = any,
  Options extends TrackCollectionOptions<T> = TrackCollectionOptions<T>
> extends TypedEmitter<TrackCollectionEvents<T>>
{
  protected _ready: boolean = false;

  protected tracks: T[] = [];
  protected trackIdMap: Map<string, T> = new Map();

  extra: Extra;

  protected logger!: Logger;

  constructor(readonly id: string, extra: Extra, public options: Options) {
    super();

    this.logger = createLogger({
      name: 'collection',
      id: [this.options.logPrefix, this.id].filter(s => !!s).join('/'),
    });

    this.extra = extra;
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

  #shiftCounter = 0;

  shift(): T | undefined {
    const track = this.tracks.shift();

    if (this.options.reshuffleEvery) {
      ++this.#shiftCounter;

      if (this.#shiftCounter >= this.options.reshuffleEvery) {
        this.logger.info('Re-shuffle every %d tracks', this.options.reshuffleEvery);

        this.#shiftCounter = 0;
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

  async #transform(options: {
    paths: string[];
    chunkSize?: number;
    onChunkCreated: ChunkHandler<T>
  }) {
    const { paths, onChunkCreated, chunkSize = 25 * os.cpus().length } = options;
    const validPaths = chain(paths)
      .castArray()
      .map(p => normalizePath(p))
      .filter(TrackCollection.isKnownFileExtension)
      .uniq()
      .value();

    if (!validPaths?.length) {
      onChunkCreated([], 0, 0);
      return {
        scanned: [],
        added: []
      };
    }

    const immediateTracks: T[] = [];
    const newTracks: T[] = [];

    const buckets = chunk(validPaths, Math.max(os.cpus().length, chunkSize));

    for (const [index, bucket] of buckets.entries()) {
      const created = new Array<T>(bucket.length);

      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        const trackId = await this.getTrackId(p);
        created[i] = await this.createTrack(p, trackId);
      }

      const added = await onChunkCreated(created, index, buckets.length).catch(() => []);
      await waitFor(10);
      immediateTracks.push(...created);
      newTracks.push(...added);
    }

    return {
      scanned: immediateTracks,
      added: newTracks
    };
  }

  async add(options: {
    paths: string[];
    mode?: TrackAddingMode;
    updateExisting?: boolean;
    chunkSize?: number;
    onChunkAdded?: ChunkHandler<T>;
  }) {
    const { paths, mode, updateExisting, chunkSize, onChunkAdded } = options;

    let totalUpdatedCount = 0;

    const transformed = await this.#transform({
      paths,
      chunkSize,
      onChunkCreated: async (tracks, chunkIndex, totalChunks) => {
        const { added, updated } = await this.#addTracks({
          tracks,
          chunkIndex,
          totalChunks,
          mode,
          updateExisting
        });

        await onChunkAdded?.(tracks, chunkIndex, totalChunks);

        totalUpdatedCount += updated;

        return added;
      }
    });

    return {
      ...transformed,
      updated: totalUpdatedCount
    }
  }

  async #addTracks(options: {
    tracks: T[];
    chunkIndex: number;
    totalChunks: number;
    mode?: TrackAddingMode;
    updateExisting?: boolean;
  }) {
    const {
      tracks,
      chunkIndex,
      totalChunks,
      mode = this.options.newTracksAddingMode ?? 'spread',
      updateExisting
    } = options;

    const { tracksMapper } = this.options;

    const newTracks = tracks.filter(it => !this.trackIdMap.has(it.id));
    let updatedCount = 0;

    if (updateExisting) {
      const tracksToUpdate = (await Promise.all(tracks
        .filter(it => this.trackIdMap.has(it.id))
        .map(async (track) => {
          const s = await stat(track.path).catch(() => undefined);
          return (s !== undefined && s.mtimeMs > (track.extra?.timestamp ?? 0))
            ? track
            : undefined
        })
      )).filter((t): t is Awaited<T> => t !== undefined);

      const updated = tracksToUpdate.length > 0
        ? await this.#internalUpdate(tracksToUpdate)
        : undefined;

      if (updated !== undefined)  {
        updatedCount = updated.length;
      }
    }

    const mapped = await tracksMapper?.(newTracks) ?? newTracks;

    if (mapped.length) {
      switch (mode) {
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

      this.logger.info(`${mapped.length} track(s) added`);
      this.emit('tracksAdd', mapped, chunkIndex, totalChunks);
    }

    return {
      added: mapped,
      updated: updatedCount
    };
  }

  async #internalUpdate(tracks: T[]) {
    if (tracks.length <= 0) {
      return;
    }

    const e: TracksUpdateEvent<T> = {
      tracks,
      updatedTracks: [],
      promises: []
    };

    this.emit('tracksUpdate', e);

    await Promise.all(e.promises);

    if (e.updatedTracks.length > 0) {
      this.logger.info(`${e.updatedTracks.length} track(s) updated`);
    }

    return e.updatedTracks;
  }

  async update(paths: string[]) {
    return this.#transform({
      paths,
      onChunkCreated: async updated => {
        const existing = updated.filter(it => this.trackIdMap.has(it.id));

        this.#internalUpdate(existing);

        return existing;
      }
    });
  }

  clear() {
    if (this.tracks.length) {
      this.emit('tracksRemove', this.tracks);
      this.logger.info('%d track(s) deleted', this.tracks.length);
    }

    this.emit('refresh');

    this.tracks = [];
    this.trackIdMap.clear();
  }

  removeBy(predicate: (track: T) => boolean): T[] {
    const [removed, remaining] = partition(this.tracks, predicate);
    this.tracks = remaining;

    for (const { id } of removed) {
      this.trackIdMap.delete(id);
    }

    if (removed.length) {
      this.emit('tracksRemove', removed);
      this.logger.info('%d track(s) deleted', removed.length);
    }

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

  async removeNonExistent(options: { fileExistentChecker: (path: string) => Promise<boolean>}) {
    const existences = await Promise.all(this.tracks.map(async track => ({
      track,
      exists: await options.fileExistentChecker(track.path)
    })));

    const [existing, removed] = partition(existences, e => e.exists);

    this.tracks = existing.map(t => t.track);
    const removedTracks = removed.map(t => t.track);

    for (const track of removedTracks) {
      this.trackIdMap.delete(track.id);
    }

    if (removedTracks.length) {
      this.emit('tracksRemove', removedTracks);
      this.logger.info('%d track(s) deleted', removedTracks.length);
    }

    return removedTracks;
  }

  delete(index: number): boolean {
    const deleted = this.tracks.splice(index, 1);

    for (const t of deleted) {
      this.trackIdMap.delete(t.id);
    }

    if (deleted.length === 0) {
      return false;
    }

    this.emit('tracksRemove', deleted);

    return true;
  }

  move(newPosition: number, indexes: number[]) {
    moveArrayIndexes(this.tracks, newPosition, ...indexes);
    this.emit('refresh');
  }

  moveTrack(newPosition: number, tracks: T | T[]) {
    moveArrayElements(this.tracks, newPosition, ...castArray(tracks));
    this.emit('refresh');
  }

  moveByPath(newPosition: number, paths: string | string[]) {
    const toMove = castArray(paths).map(path => this.fromPath(path));
    moveArrayElements(this.tracks, newPosition, ...toMove);
    this.emit('refresh');
  }

  async shuffle() {
    await this.shuffleBy(shuffle);
  }

  async shuffleBy(fn: (tracks: T[]) => T[] | Promise<T[]>) {
    this.tracks = await fn(this.tracks);
    this.emit('refresh');
  }

  sort(
    sortFn: ((track: T) => unknown)[],
    filter?: (track: T) => boolean,
    done = true
  ) {
    if (!sortFn.length) {
      sortFn = [track => track.path];
    }

    if (filter === undefined) {
      this.tracks = sortBy(this.tracks, ...sortFn);
      return;
    }

    const scoped = this.tracks
      .map<TrackIndex<T>>((track, index) => ({ track, index }))
      .filter(t => filter(t.track));

    const indexes = scoped.map(p => p.index);

    const sorted = sortBy(scoped, ...sortFn.map(fn => (item: TrackIndex<T>) => fn(item.track)));

    for (const [index, t] of zip(indexes, sorted)) {
      if (index === undefined || t === undefined) {
        continue;
      }

      if (index !== t.index) {
        this.tracks.splice(index, 1, t.track);
      }
    }

    if (done) {
      this.emit('refresh');
    }
  }

  indexOf(track: T): number {
    return this.findIndex(t => t.id === track.id);
  }

  at(index: number): T | undefined {
    return this.tracks[index];
  }

  fromPath(path: string) {
    return this.tracks.find(track => track.path === path);
  }

  find(predicate: (track: T, index: number) => boolean) {
    return this.tracks.find((track, index) => predicate(track, index));
  }

  findIndex(predicate: (track: T, index: number) => boolean) {
    return this.tracks.findIndex(predicate);
  }

  fromId(id: string): T | undefined {
    return this.trackIdMap.get(id);
  }

  fromMusicId(musicId: string): T | undefined {
    return this.find(t => t.musicId === musicId);
  }

  fromTrack(track: Track<any>): T | undefined {
    const found = this.fromId(track.id);
    if (found) {
      return found;
    }

    if (track.musicId) {
      return this.fromMusicId(track.musicId);
    }
  }

  filter(fn: (track: T) => boolean) {
    return this.tracks.filter(fn);
  }

  sample(): T | undefined {
    return sample(this.tracks);
  }

  peek(centerIndex: number, count: number, filterFn: (track: T) => boolean): TrackPeek<T>[] {
    const items = this.tracks.map((track, index) => ({ track, index }));

    if (centerIndex <= 0) {
      // From the top
      return items.filter(({ track }) => filterFn(track))
        .slice(0, count)
        .map((item, localIndex) => ({
          ...item,
          localIndex
        }));
    }

    const view = items
      .filter(({ track }) => filterFn(track))
      .map((item, localIndex) => ({
        ...item,
        localIndex
      }));

    const centerItemIndex = view.findIndex(item => item.index >= centerIndex);
    const sideWidth = Math.floor(count / 2);
    const [leftItemIndex, rightItemIndex] = [-1, 1].map(d => clamp(centerItemIndex + sideWidth * d, 0, view.length - 1));

    return view.slice(leftItemIndex, rightItemIndex + 1);
  }

  [Symbol.iterator](): Iterator<T, any, undefined> {
    return this.tracks.values();
  }

  all(): T[] {
    return [...this.tracks];
  }
}
