import os from 'node:os';
import path, { dirname } from 'node:path';
import { stat } from "node:fs/promises";

import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import { chain, debounce, noop, once, shuffle, stubFalse, sumBy, uniq, difference } from "lodash";
import normalizePath from "normalize-path";
import watcher, { AsyncSubscription, SubscribeCallback, BackendType } from '@parcel/watcher';

import { ChunkHandler, TrackCollection, TrackCollectionOptions } from "./base";
import { Track, TrackExtra, TrackExtraOf } from "../track";
import { breath } from '@seamless-medley/utils';
import { getThreadPoolSize } from '../utils';

export type WatchOptions = {

}

export type WatchPathWithOption = {
  dir: string;
  options?: WatchOptions;
}

type WatchInfo = {
  options?: WatchOptions;
  subscription?: AsyncSubscription;
  handler: SubscribeCallback;
}

export type FileScanOptions = {
  dir: string;
  chunkSize: number;

  onFiles: (files: string[]) => Promise<void>;
  onDone: () => Promise<void>;
}

export type FileScanner = (info: FileScanOptions) => Promise<true | undefined>;

export type WatchTrackCollectionOptions<T extends Track<any>> = TrackCollectionOptions<T> & {
  // scanner?: (dir: string) => Promise<false | string[]>;
  scanner?: FileScanner;
}

export type ScanStats = {
  scanned: number;
  added: number;
  removed: number;
  updated: number;
}

export type ScanFlags = {
    detectAddition: boolean;
    detectRemoval: boolean;
    updateExisting: boolean;
  }

type ScanOptions = {
  dir: string;
  flags: ScanFlags;
  chunkSize?: number;
  onFirstChunkAdded?: () => any;
}

export type RescanOptions = {
  flags: ScanFlags;
  onlyCollections?: string[];
}

export type RescanStats = ScanStats & {
  removed: number;
}

export class WatchTrackCollection<T extends Track<TE>, TE extends TrackExtra = TrackExtraOf<T>, Extra = any> extends TrackCollection<T, TE, Extra, WatchTrackCollectionOptions<T>> {
  constructor(id: string, extra: Extra, options: WatchTrackCollectionOptions<T> = {}) {
    super(id, extra, {
      tracksMapper: async (tracks) => shuffle(tracks),
      ...options
    });
  }

  protected override afterConstruct() {

  }

  protected override becomeReady(): void {
    WatchTrackCollection.#monitor(this);

    super.becomeReady();
  }

  #watchInfos = new Map<string, WatchInfo>();

  #newPaths: string[] = [];
  #updatePaths: string[] = [];
  #removedIds = new Set<string>();

  #fetchNewPaths() {
    const result = uniq(this.#newPaths);
    this.#newPaths = [];
    return result;
  }

  #storeNewFiles = debounce(() => this.add({ paths: this.#fetchNewPaths() }), 3000);

  #fetchUpdatePaths(): string[] {
    const result = uniq(this.#updatePaths);
    this.#updatePaths = [];
    return result;
  }

  #updateFiles = debounce(() => this.update(this.#fetchUpdatePaths()), 3000);

  #handleFilesRemoval = debounce(() => {
    this.removeBy(({ id }) => this.#removedIds.has(id));
    this.#removedIds.clear();
  }, 3000);

  #handleSubscriptionEvents = (dir: string): SubscribeCallback => async (error, events) => {
    if (error) {
      const normalized = normalizePath(dir);

      this.logger.error('Error in subscription for dir: %s marking it for re-subscribing', normalized);

      const info = this.#watchInfos.get(normalized);

      if (info) {
        info.subscription?.unsubscribe();
        info.subscription = undefined;
      }

      return;
    }

    const byType = chain(events)
      .uniqBy(({ path, type }) => `${type}:${path}`)
      .groupBy('type')
      .value() as Partial<Record<watcher.EventType, watcher.Event[]>>;

    if (byType.delete) {
      this.#handlePathDeletion(byType.delete);
    }

    if (byType.create) {
      this.#handlePathCreation(byType.create);
    }

    if (byType.update) {
      this.#handlePathUpdate(byType.update);
    }
  }

  async #handlePathDeletion(events: watcher.Event[]) {
    for (let { path } of events) {
      path = normalizePath(path);

      const files = this.tracks.filter(t => {
        const n = normalizePath(dirname(t.path));
        return n === path;
      });

      if (files.length) {
        // This is sub-folder deletion
        for (const { id } of files) {
          this.#removedIds.add(id);
        }

        continue;
      }

      // File deletion
      this.#removedIds.add(await this.getTrackId(path));
    }

    this.#handleFilesRemoval();
  }

  async #handlePathCreation(events: watcher.Event[]) {
    for (let { path } of events) {
      path = normalizePath(path);

      const stats = await stat(path).catch(stubFalse);

      if (!stats) {
        continue;
      }

      if (stats.isDirectory()) {
        // A sub folder rename results in a single create event, explicitly scan the path now
        this.#scan({
          dir: path,
          flags: {
            detectAddition: true,
            detectRemoval: false,
            updateExisting: false
          }
        });
        continue;
      }

      this.#newPaths.push(path);
    }

    this.#storeNewFiles();
  }

  async #handlePathUpdate(events: watcher.Event[]) {
    this.#updatePaths.push(...events.map(e => normalizePath(e.path)));
    this.#updateFiles();
  }

  async #subscribeToPath(normalizedPath: string, options?: WatchOptions) {
    if (!this.#watchInfos.has(normalizedPath)) {
      this.#watchInfos.set(normalizedPath, {
        options,
        handler: this.#handleSubscriptionEvents(normalizedPath)
      })
    }

    const info = this.#watchInfos.get(normalizedPath)!;

    info.subscription = await watch(normalizedPath, info.handler, options);
  }

  #createResumeSubscriptionTasks() {
    return [...this.#watchInfos.entries()]
      .filter(([, { subscription }]) => subscription === undefined)
      .map(([dir, info]) => this.#createResumeSubscriptionTask(dir, info));
  }

  #createResumeSubscriptionTask = (dir: string, info: WatchInfo): ResumeSubscriptionTask => async () => {
    await this.#subscribeToPath(normalizePath(dir), info.options);

    if (info.subscription) {
      this.logger.info(`Resume subscription for ${dir}`);
      await this.#scan({
        dir,
        flags: {
          detectAddition: true,
          detectRemoval: true,
          updateExisting: true
        }
      });
    }
  }

  /**
   * Watch a directory for changes
   *
   * Do not use this with filename, just use add() method instead
   *
   * Note that adding individual file does not monitor for file changes
   * and it will be lost when a full re-scan occur
   */
  async watch({ dir, options }: WatchPathWithOption) {
    const normalized = normalizePath(dir);

    if (this.#watchInfos.has(normalized)) {
      return;
    }

    await this.#scan({
      dir: normalized,
      flags: {
        detectAddition: true,
        detectRemoval: false,
        updateExisting: false
      },
      onFirstChunkAdded: async () => {
        this.logger.info(`Watching ${normalized}`);
        await this.#subscribeToPath(normalized, options);
        this.becomeReady();
      }
    });
  }

  unwatch(dir: string, removeTracks: boolean = true) {
    dir = normalizePath(dir);

    const info = this.#watchInfos.get(dir);
    if (info) {
      info.subscription?.unsubscribe();
    }

    this.#watchInfos.delete(dir);

    if (removeTracks) {
      this.removeBy(({ path }) => minimatch(path, dir));
    }
  }

  unwatchAll(removeTracks: boolean = true) {
    for (const dir of this.#watchInfos.keys()) {
      this.unwatch(dir, removeTracks);
    }
  }

  #extScanner: FileScanner = async (info: FileScanOptions) => {
    if (!this.options.scanner) {
      return;
    }

    this.options.scanner(info);
    return true;
  }

  #globScanner: FileScanner = async (info: FileScanOptions) => {
    const result = await glob(`${normalizePath(info.dir)}/**/*`).catch(stubFalse);
    if (!result) {
      return;
    }

    await info.onFiles(result);
    info.onDone();
    return true;
  }

  #scanPromises = new Map<string, Promise<ScanStats>>();

  async #scan({ dir, onFirstChunkAdded, chunkSize, flags }: ScanOptions): Promise<ScanStats> {
    if (this.#scanPromises.has(dir)) {
      return this.#scanPromises.get(dir)!;
    }

    const counter: ScanStats = {
      scanned: 0,
      added: 0,
      removed: 0,
      updated: 0
    }

    if (!(flags.detectAddition || flags.detectRemoval || flags.updateExisting)) {
      return Promise.resolve(counter);
    }

    this.emit('scan' as any, this, path.normalize(dir));

    const onChunkAdded = once(onFirstChunkAdded ?? noop) as ChunkHandler<T>;

    const scanners: Array<FileScanner> = [this.#extScanner, this.#globScanner];

    chunkSize = chunkSize ?? getThreadPoolSize(this.options.auxiliary ? 10 : 20);

    const scannedFiles: string[] = [];

    const promise = new Promise<ScanStats>(async (resolve) => {
      for (const scanner of scanners) {
        const ok = await scanner.call(this, {
          dir,
          chunkSize,

          onFiles: async (files) => {
            scannedFiles.push(...files);
          },

          onDone: async () => {
            let removed = 0;

            if (flags?.detectRemoval) {
              const dirPath = path.resolve(dir);

              const isFileInDir = (filePath: string) => {
                const rel = path.relative(dirPath, path.resolve(filePath));
                return !rel.startsWith('..') && !path.isAbsolute(rel);
              }

              const knownPathsForDir = this.tracks
                .map(t => t.path)
                .filter(isFileInDir);

              const absentFilePaths = difference(knownPathsForDir, scannedFiles);
              removed = (await this.remove(absentFilePaths)).length;
            }

            if (flags.detectAddition || flags.updateExisting) {
              const { scanned, added, updated } = await this.add({
                paths: shuffle(scannedFiles),
                updateExisting: flags.updateExisting,
                chunkSize,
                onChunkAdded
              });

              await breath();

              counter.scanned += scanned.length;
              counter.added += added.length;
              counter.updated += updated;
            }

            counter.removed += removed;

            this.emit('scan-done' as any, this, path.normalize(dir));

            this.#scanPromises.delete(dir);

            resolve(counter);
          }
        });

        if (ok) {
          break;
        }
      }
    });

    this.#scanPromises.set(dir, promise);
    return promise;
  }

  async rescan(flags: ScanFlags): Promise<RescanStats | undefined> {
    const results: ScanStats[] = [];

    for (const dir of this.#watchInfos.keys()) {
      results.push(await this.#scan({
        dir,
        flags
      }));

      await breath();
    }

    return {
      scanned: sumBy(results, c => c.scanned),
      added: sumBy(results, c => c.added),
      updated: sumBy(results, c => c.updated),
      removed: sumBy(results, c => c.removed)
    }
  }

  async rewatch() {
    const entries = [...this.#watchInfos.entries()];

    this.unwatchAll(false);

    for (const [dir, { options }] of entries) {
      this.watch({ dir, options });
    }
  }

  static #monitorTimer?: NodeJS.Timeout;

  static #monitorings: Array<WatchTrackCollection<any>> = [];

  static #monitor(w: WatchTrackCollection<any>) {
    if (this.#monitorings.indexOf(w) !== -1) {
      return;
    }

    this.#monitorings.push(w);

    if (this.#monitorTimer === undefined) {
      this.#scheduleMonitor(2000);
    }
  }

  static async #doMonitor() {
    const w = this.#monitorings.shift();

    if (w) {
      this.#monitorings.push(w);

      const tasks = w.#createResumeSubscriptionTasks();

      if (tasks.length) {
        for (const task of tasks) {
          await task().then(breath);
        }

        this.#scheduleMonitor(2000);
        return;
      }
    }

    this.#scheduleMonitor(200);
  }

  static #scheduleMonitor(delay: number) {
    if (this.#monitorTimer) {
      clearTimeout(this.#monitorTimer);
    }

    this.#monitorTimer = setTimeout(() => this.#doMonitor(), delay);
  }
}

type ResumeSubscriptionTask = () => Promise<void>;

const glob = (pattern: string) => fg(pattern, {
  absolute: true,
  onlyFiles: true,
  braceExpansion: true,
  suppressErrors: true,
});

function getPlatformBackend(platform: NodeJS.Platform = os.platform()): BackendType {
  switch (platform) {
    case 'win32':
      return 'windows';

    case 'darwin':
      return 'fs-events';

    case 'linux':
      return 'inotify';

    default:
      return 'brute-force';
  }
}

export async function watch(dir: string, callback: SubscribeCallback, options?: WatchOptions) {
  const stats = await stat(dir).catch(stubFalse);

  if (!stats) {
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  try {
    return await watcher.subscribe(dir, callback, { backend: getPlatformBackend() });
  }
  catch (e) {

  }
}
