import fg from 'fast-glob';
import mm from 'minimatch';
import { debounce, groupBy, noop, shuffle, uniq } from "lodash";
import normalizePath from "normalize-path";
import { Track } from "../track";
import { TrackCollection, TrackCollectionOptions } from "./base";
import { stat } from "fs/promises";

import watcher, { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';
import { dirname } from 'path';

export class WatchTrackCollection<T extends Track<any, E>, E = any> extends TrackCollection<T, E> {
  constructor(id: string, options: TrackCollectionOptions<T> = {}) {
    super(id, {
      tracksMapper: async (tracks) => shuffle(tracks),
      ...options
    });
  }

  protected afterConstruct() {

  }

  private subscriptions = new Map<string, AsyncSubscription>();

  private newPaths: string[] = [];
  private removedIds = new Set<string>();

  private fetchNewPaths() {
    const result = uniq(this.newPaths);
    this.newPaths = [];
    return result;
  }

  private storeNewFiles = debounce(() => this.add(this.fetchNewPaths()), 2000);

  private handleFilesRemoval = debounce(() => {
    this.removeBy(({ id }) => this.removedIds.has(id));
    this.removedIds.clear();
  }, 2000);

  private handleSubscriptionEvents = (dir: string): SubscribeCallback => async (error, events) => {
    if (error) {
      this.logger.error('Error in watcher for dir:', dir, 'Error: ', error);
      return;
    }

    console.log('Watch events', events);

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
    this.newPaths.push(...events.map(e => normalizePath(e.path)));
    this.storeNewFiles();
  }

  async watch(dir: string) {
    const normalized = normalizePath(dir);

    if (!this.subscriptions.has(normalized)) {
      await this.scan(normalized).catch(noop);

      const subscription = await watcher.subscribe(normalized, this.handleSubscriptionEvents(normalized));
      this.subscriptions.set(normalized, subscription);
      this.becomeReady();
    }
  }

  unwatch(dir: string, removeTracks: boolean = true) {
    dir = normalizePath(dir);

    const subscription = this.subscriptions.get(dir);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(dir);
    }

    if (removeTracks) {
      this.removeBy(({ path }) => mm(path, dir));
    }
  }

  unwatchAll(removeTracks: boolean = true) {
    for (const dir of this.subscriptions.keys()) {
      this.unwatch(dir, removeTracks);
    }
  }

  private async scan(dir: string) {
    dir = normalizePath(dir);
    return glob(`${dir}/**/*`).then(files => this.add(files));
  }

  async rescan(rewatch?: boolean) {
    if (!rewatch) {
      for (const dir of this.subscriptions.keys()) {
        this.scan(dir);
      }

      return;
    }

    const dirs = this.subscriptions.keys();

    this.unwatchAll(false);

    for (const dir of dirs) {
      this.watch(dir);
    }
  }
}

const glob = (pattern: string) => fg(pattern, { absolute: true, onlyFiles: true });
