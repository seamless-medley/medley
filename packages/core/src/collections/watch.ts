import fg from 'fast-glob';
import mm from 'minimatch';
import { debounce, shuffle, stubFalse } from "lodash";
import normalizePath from "normalize-path";
import { Track } from "../track";
import globParent from 'glob-parent';
import { TrackCollection, TrackCollectionOptions } from "./base";
import { FSWatcher } from "fs";
import watch from "node-watch";
import { stat } from "fs/promises";

type WatchCallback<F = typeof watch> = F extends (pathName: any, options: any, callback: infer CB) => any ? CB : never;

// A track collection capable of watching for changes in file system directory
export class WatchTrackCollection<T extends Track<any>, E = never> extends TrackCollection<T, E> {
  constructor(id: string, options: TrackCollectionOptions<T> = {}) {
    super(id, {
      tracksMapper: async (tracks) => shuffle(tracks),
      ...options
    });
  }

  protected afterConstruct() {

  }

  private watchingPatterns = new Map<string, FSWatcher>();

  private newPaths: string[] = [];
  private removedIds = new Set<string>();

  private fetchNewPaths() {
    const result = this.newPaths;
    this.newPaths = [];
    return result;
  }

  private storeNewFiles = debounce(() => this.add(this.fetchNewPaths()), 2000);

  private handleFilesRemoval = debounce(() => {
    const removed = this.removeBy(({ id }) => this.removedIds.has(id));

    if (removed.length) {
      this.logger.info('Removed', removed.length, 'tracks');
    }

    this.removedIds.clear();
  }, 2000);

  private watchHandler: WatchCallback = async (event, path) => {
    if (event === 'update') {
      const isFile = (await stat(path).then(s => s.isFile()).catch(stubFalse));
      if (isFile) {
        this.newPaths.push(path);
        this.storeNewFiles();
      }
      return;
    }

    if (event === 'remove') {
      this.removedIds.add(await this.getTrackId(path));
      this.handleFilesRemoval();
      return;
    }
  }

  watch(pattern: string): this {
    this.scan(pattern)
      .then(() => {
        const normalized = normalizePath(pattern);
        const recursively = { recursive: true };
        //
        const watcher = watch(globParent(normalized), recursively, this.watchHandler);
        this.watchingPatterns.set(normalized, watcher);
      })
      .then(() => this.becomeReady());

    return this;
  }

  unwatch(pattern: string) {
    const normalized = normalizePath(pattern);

    const watcher = this.watchingPatterns.get(pattern);
    if (watcher) {
      watcher.close();
    }

    this.watchingPatterns.delete(normalized);
    this.removeBy(({ path }) => mm(path, normalized));
  }

  unwatchAll() {
    for (const [pattern] of this.watchingPatterns) {
      this.unwatch(pattern);
    }
  }

  get watched() {
    return Array.from(this.watchingPatterns);
  }

  private async scan(pattern: string) {
    const normalized = normalizePath(pattern);
    return glob(normalized).then(files => this.add(files))
  }

  async rescan() {
    for (const [pattern] of this.watched) {
      await this.scan(pattern);
    }
  }
}

const glob = (pattern: string) => fg(pattern, { absolute: true, onlyFiles: true });
