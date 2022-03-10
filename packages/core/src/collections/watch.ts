import chokidar from "chokidar";
import fg from 'fast-glob';
import mm from 'minimatch';
import { debounce, shuffle } from "lodash";
import normalizePath from "normalize-path";
import { Track } from "../track";
import globParent from 'glob-parent';
import { TrackCollection, TrackCollectionOptions } from "./base";

// A track collection capable of watching for changes in file system directory
export class WatchTrackCollection<T extends Track<any>, M = never> extends TrackCollection<T, M> {
  static initWithWatch<T extends Track<any>, M = never>(id: string, paths: string, options: TrackCollectionOptions<T> = {}): WatchTrackCollection<T, M> {
    const inst = new WatchTrackCollection<T, M>(id, options);
    inst.watch(paths);
    return inst;
  }

  constructor(id: string, options: TrackCollectionOptions<T> = {}) {
    super(id, {
      tracksMapper: async (tracks) => shuffle(tracks),
      ...options
    });
  }

  protected afterConstruct() {

  }

  private watchingPatterns = new Set<string>();

  private newPaths: string[] = [];
  private removedIds = new Set<string>();

  private fetchNewPaths() {
    const result = this.newPaths;
    this.newPaths = [];
    return result;
  }

  private storeNewTracks = debounce(() => this.add(this.fetchNewPaths()), 2000);

  private handleTracksRemoval = debounce(() => {
    this.removeBy(({ id }) => this.removedIds.has(id));
    this.removedIds.clear();
  }, 2000);

  protected watcher = chokidar.watch([])
    .on('ready', () => {
      this.storeNewTracks.flush();
      this.becomeReady();
    })
    .on('add', (path) => {
      this.newPaths.push(path);
      this.storeNewTracks();
    })
    .on('unlink', (path) => {
      this.removedIds.add(this.computePathId(path));
      this.handleTracksRemoval();
    });

  watch(pattern: string): this {
    const normalized = normalizePath(pattern);

    fg(normalized, { absolute: true, onlyFiles: true })
      .then(files => this.add(files))
      .then(() => {
        const parent = globParent(normalized);

        this.watcher.add(parent);
        this.watchingPatterns.add(parent);
      })
      .then(() => {
        this.becomeReady();
      });

    return this;
  }

  unwatch(pattern: string) {
    this.watcher.unwatch(pattern);
    this.watchingPatterns.delete(pattern);
    this.removeBy(({ path }) => mm(path, pattern));
  }

  unwatchAll() {
    for (const pattern of this.watchingPatterns) {
      this.unwatch(pattern);
    }
  }

  get watched() {
    return Array.from(this.watchingPatterns);
  }
}