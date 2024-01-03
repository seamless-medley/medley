import os from 'node:os';
import { dirname } from 'node:path';
import { stat } from "node:fs/promises";
import which from 'which';

import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import { debounce, groupBy, noop, once, shuffle, stubFalse, stubTrue, uniq } from "lodash";
import normalizePath from "normalize-path";
import watcher, { AsyncSubscription, SubscribeCallback, BackendType } from '@parcel/watcher';

import { TrackCollection, TrackCollectionOptions } from "./base";
import { Track } from "../track";
import { breath } from '@seamless-medley/utils';

type WatchInfo = {
  subscription?: AsyncSubscription;
  handler: SubscribeCallback;
}

export type WatchTrackCollectionOptions<T extends Track<any>> = TrackCollectionOptions<T> & {
  scanner?: (dir: string) => Promise<false | string[]>;
}

export class WatchTrackCollection<T extends Track<any>, Extra = any> extends TrackCollection<T, Extra, WatchTrackCollectionOptions<T>> {
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

  #storeNewFiles = debounce(() => this.add(this.#fetchNewPaths()), 2000);

  #fetchUpdatePaths(): string[] {
    const result = uniq(this.#updatePaths);
    this.#updatePaths = [];
    return result;
  }

  #updateFiles = debounce(() => this.update(this.#fetchUpdatePaths()), 2000);

  #handleFilesRemoval = debounce(() => {
    this.removeBy(({ id }) => this.#removedIds.has(id));
    this.#removedIds.clear();
  }, 2000);

  #handleSubscriptionEvents = (dir: string): SubscribeCallback => async (error, events) => {
    if (error) {
      const normalized = normalizePath(dir);

      this.logger.error(error, 'Error in subscription for dir: %s marking it for re-subscribing', normalized);

      const info = this.#watchInfos.get(normalized);

      if (info) {
        info.subscription?.unsubscribe();
        info.subscription = undefined;
      }

      return;
    }

    const byType = groupBy(events, 'type') as Partial<Record<watcher.EventType, watcher.Event[]>>;

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

    this.logger.info('%d track(s) deleted', this.#removedIds.size);

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
        this.#scan(path);
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

  async #subscribeToPath(normalizedPath: string) {
    if (!this.#watchInfos.has(normalizedPath)) {
      this.#watchInfos.set(normalizedPath, {
        handler: this.#handleSubscriptionEvents(normalizedPath)
      })
    }

    const info = this.#watchInfos.get(normalizedPath)!;

    info.subscription = await watch(normalizedPath, info.handler);
  }

  #createResumeSubscriptionTasks() {
    return [...this.#watchInfos.entries()]
      .filter(([, { subscription }]) => subscription === undefined)
      .map(([dir, info]) => this.#createResumeSubscriptionTask(dir, info));
  }

  #createResumeSubscriptionTask = (dir: string, info: WatchInfo): ResumeSubscriptionTask => async () => {
    await this.#subscribeToPath(normalizePath(dir));

    if (info.subscription) {
      this.logger.info(`Resume subscription for ${dir}`);
      await this.#scan(dir);
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
  async watch(dir: string) {
    const normalized = normalizePath(dir);

    if (this.#watchInfos.has(normalized)) {
      return;
    }

    this.logger.info(`Watching ${normalized}`);

    await this.#scan(normalized, async () => {
      await this.#subscribeToPath(normalized);
      this.becomeReady();
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

  async #extScanner(dir: string) {
    if (!this.options.scanner) {
      return false;
    }

    return this.options.scanner(dir).catch(stubFalse);
  }

  async #globScanner(dir: string) {
    return glob(`${normalizePath(dir)}/**/*`).catch(stubFalse);
  }

  async #scan(dir: string, fn: () => any = () => noop) {
    const done = once(fn);

    const scanners = [this.#extScanner, this.#globScanner];

    for (const scanner of scanners) {
      const files = await scanner.call(this, dir);

      if (files !== false) {
        await this.add(shuffle(files), undefined, done).then(breath);
        break;
      }
    }
  }

  async rescan(full?: boolean) {
    if (full) {
      this.clear();
    }

    for (const dir of this.#watchInfos.keys()) {
      this.#scan(dir);
    }
  }

  async rewatch() {
    const dirs = this.#watchInfos.keys();

    this.unwatchAll(false);

    for (const dir of dirs) {
      this.watch(dir);
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

let watchManAvailable: boolean | undefined;

async function isWatchManAvailable() {
  if (watchManAvailable !== undefined) {
    return watchManAvailable;
  }

  const found = await which('watchman').then(stubTrue).catch(stubFalse);
  watchManAvailable = found;
  return found;
}

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

async function getBackends(): Promise<BackendType[]> {
  const defaultBackend = getPlatformBackend();
  const hasWatchman = await isWatchManAvailable();
  return hasWatchman ? ['watchman', defaultBackend] : [defaultBackend];
}

async function watch(dir: string, callback: SubscribeCallback) {
  const stats = await stat(dir).catch(stubFalse);

  if (!stats) {
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  const backends = await getBackends();

  for (const backend of backends) {
    try {
      return await watcher.subscribe(dir, callback, { backend });
    }
    catch (e) {
      continue;
    }
  }
}
