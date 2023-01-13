import { dirname } from 'path';
import { stat } from "fs/promises";

import node_glob from 'glob';
import mm from 'minimatch';
import { debounce, groupBy, shuffle, stubFalse, uniq } from "lodash";
import normalizePath from "normalize-path";
import watcher, { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';

import { TrackCollection, TrackCollectionOptions } from "./base";
import { Track } from "../track";

type WatchInfo = {
  subscription?: AsyncSubscription;
  handler: SubscribeCallback;
}

export class WatchTrackCollection<T extends Track<any, E>, E = any> extends TrackCollection<T, E> {
  constructor(id: string, options: TrackCollectionOptions<T> = {}) {
    super(id, {
      tracksMapper: async (tracks) => shuffle(tracks),
      ...options
    });
  }

  protected afterConstruct() {

  }

  protected becomeReady(): void {
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

      const stats = await stat(path).catch(() => undefined);

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

    info.subscription = await watcher.subscribe(normalizedPath, info.handler).catch(() => undefined);
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

    this.logger.debug('Watching', normalized);

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
      this.removeBy(({ path }) => mm(path, dir));
    }
  }

  unwatchAll(removeTracks: boolean = true) {
    for (const dir of this.watchInfos.keys()) {
      this.unwatch(dir, removeTracks);
    }
  }

  private async scan(dir: string) {
    const files = await glob(`${normalizePath(dir)}/**/*`).catch(stubFalse);

    if (files !== false) {
      this.add(shuffle(files));
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

const glob = (pattern: string) => new Promise<string[]>((resolve, reject) => {
  node_glob(pattern, (err, matches) => {
    if (err) {
      reject(err);
      return;
    }

    resolve(matches);
  })
});
