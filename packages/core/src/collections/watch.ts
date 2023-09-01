import os from 'node:os';
import { dirname } from 'node:path';
import { stat } from "node:fs/promises";
import which from 'which';

import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import { debounce, groupBy, shuffle, stubFalse, stubTrue, uniq } from "lodash";
import normalizePath from "normalize-path";
import watcher, { AsyncSubscription, SubscribeCallback, BackendType } from '@parcel/watcher';

import { TrackCollection, TrackCollectionOptions } from "./base";
import { Track } from "../track";

type WatchInfo = {
  subscription?: AsyncSubscription;
  handler: SubscribeCallback;
}

export type WatchTrackCollectionOptions<T extends Track<any>> = TrackCollectionOptions<T> & {
  scanner?: (dir: string) => Promise<false | string[]>;
}

export class WatchTrackCollection<T extends Track<any>, Extra = any> extends TrackCollection<T, Extra> {
  constructor(id: string, extra: Extra, public options: WatchTrackCollectionOptions<T> = {}) {
    super(id, extra, {
      tracksMapper: async (tracks) => shuffle(tracks),
      ...options
    });
  }

  protected override afterConstruct() {

  }

  protected override becomeReady(): void {
    if (!this._ready) {
      setInterval(this.resubscribe, 5000);
    }

    super.becomeReady();
  }

  private watchInfos = new Map<string, WatchInfo>();

  private newPaths: string[] = [];
  private updatePaths: string[] = [];
  private removedIds = new Set<string>();

  private fetchNewPaths() {
    const result = uniq(this.newPaths);
    this.newPaths = [];
    return result;
  }

  private storeNewFiles = debounce(() => this.add(this.fetchNewPaths()), 2000);

  private fetchUpdatePaths(): string[] {
    const result = uniq(this.updatePaths);
    this.updatePaths = [];
    return result;
  }

  private updateFiles = debounce(() => this.update(this.fetchUpdatePaths()), 2000);

  private handleFilesRemoval = debounce(() => {
    this.removeBy(({ id }) => this.removedIds.has(id));
    this.removedIds.clear();
  }, 2000);

  private handleSubscriptionEvents = (dir: string): SubscribeCallback => async (error, events) => {
    if (error) {
      const normalized = normalizePath(dir);

      this.logger.error('Error in subscription for dir:', normalized, 'marking it for re-subscribing, the error was:', error);

      const info = this.watchInfos.get(normalized);

      if (info) {
        info.subscription?.unsubscribe();
        info.subscription = undefined;
      }

      return;
    }

    const byType = groupBy(events, 'type') as Partial<Record<watcher.EventType, watcher.Event[]>>;

    if (byType.delete) {
      this.handlePathDeletion(byType.delete);
    }

    if (byType.create) {
      this.handlePathCreation(byType.create);
    }

    if (byType.update) {
      this.handlePathUpdate(byType.update);
    }
  }

  private async handlePathDeletion(events: watcher.Event[]) {
    for (let { path } of events) {
      path = normalizePath(path);

      const files = this.tracks.filter(t => {
        const n = normalizePath(dirname(t.path));
        return n === path;
      });

      if (files.length) {
        // This is sub-folder deletion
        for (const { id } of files) {
          this.removedIds.add(id);
        }

        continue;
      }

      // File deletion
      this.removedIds.add(await this.getTrackId(path));
    }

    this.handleFilesRemoval();
  }

  private async handlePathCreation(events: watcher.Event[]) {
    for (let { path } of events) {
      path = normalizePath(path);

      const stats = await stat(path).catch(stubFalse);

      if (!stats) {
        continue;
      }

      if (stats.isDirectory()) {
        // A sub folder rename results in a single create event, explicitly scan the path now
        this.scan(path);
        continue;
      }

      this.newPaths.push(path);
    }

    this.storeNewFiles();
  }

  private async handlePathUpdate(events: watcher.Event[]) {
    this.updatePaths.push(...events.map(e => normalizePath(e.path)));
    this.updateFiles();
  }

  private async subscribeToPath(normalizedPath: string) {
    if (!this.watchInfos.has(normalizedPath)) {
      this.watchInfos.set(normalizedPath, {
        handler: this.handleSubscriptionEvents(normalizedPath)
      })
    }

    const info = this.watchInfos.get(normalizedPath)!;

    info.subscription = await watch(normalizedPath, info.handler);
  }

  /**
   * Re-subscribe all broken subscriptions
   */
  private resubscribe = async () => {
    for (const [dir, info] of this.watchInfos) {
      if (info.subscription !== undefined) {
        continue;
      }

      await this.subscribeToPath(normalizePath(dir))

      if (info.subscription) {
        this.logger.info('Resume subscription for', dir);
        this.scan(dir);
      }
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

    if (this.watchInfos.has(normalized)) {
      return;
    }

    this.logger.info('Watching', normalized);

    await this.scan(normalized);
    await this.subscribeToPath(normalized);
    this.becomeReady();
  }

  unwatch(dir: string, removeTracks: boolean = true) {
    dir = normalizePath(dir);

    const info = this.watchInfos.get(dir);
    if (info) {
      info.subscription?.unsubscribe();
    }

    this.watchInfos.delete(dir);

    if (removeTracks) {
      this.removeBy(({ path }) => minimatch(path, dir));
    }
  }

  unwatchAll(removeTracks: boolean = true) {
    for (const dir of this.watchInfos.keys()) {
      this.unwatch(dir, removeTracks);
    }
  }

  private async scan(dir: string) {
    const globPromise = this.options.scanner?.(dir) ?? glob(`${normalizePath(dir)}/**/*`)

    const files = await globPromise.catch(stubFalse);

    if (files !== false) {
      await this.add(shuffle(files));
    }
  }

  async rescan(full?: boolean) {
    if (full) {
      this.clear();
    }

    for (const dir of this.watchInfos.keys()) {
      this.scan(dir);
    }
  }

  async rewatch() {
    const dirs = this.watchInfos.keys();

    this.unwatchAll(false);

    for (const dir of dirs) {
      this.watch(dir);
    }
  }
}

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
