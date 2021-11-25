import chokidar from "chokidar";
import fg from 'fast-glob';
import { debounce, reject, shuffle, without } from "lodash";
import normalizePath from "normalize-path";
import { Track } from "../track";
import { TrackCollection, TrackCollectionOptions } from "./base";

// A track collection capable of watching for changes in file system directory
export class WatchTrackCollection<T extends Track<any>> extends TrackCollection<T> {
  static initWithWatch<T extends Track<any>>(id: string, paths: string, options: TrackCollectionOptions<T> = {}): WatchTrackCollection<T> {
    const inst = new WatchTrackCollection<T>(id, options);
    inst.watch(paths);
    return inst;
  }

  constructor(id: string, options: TrackCollectionOptions<T> = {}) {
    super(id, {
      tracksMapper: shuffle,
      ...options
    });
  }

  protected afterConstruct() {

  }

  private watchingPaths: string[] = [];

  private newPaths: string[] = [];
  private removedPaths: string[] = [];

  private fetchNewPaths() {
    const result = this.newPaths;
    this.newPaths = [];
    return result;
  }

  private storeNewTracks = debounce(() => {
    const newTracks = this.fetchNewPaths();
    this.add(newTracks);
  }, 2000);

  private handleTracksRemoval = debounce(() => {
    this.tracks = reject(this.tracks, t => this.removedPaths.includes(t.path));
    this.removedPaths = [];
    this.emit('remove', this.removedPaths);
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
      this.removedPaths.push(path);
      this.handleTracksRemoval();
    });

  watch(pattern: string): this {
    fg(normalizePath(pattern), { absolute: true, onlyFiles: true })
      .then(files => this.add(files))
      .then(() => {
        this.watcher.add(pattern);
        this.watchingPaths.push(pattern);
      })
      .then(() => {
        this.emit('ready')
      });

    return this;
  }

  unwatch(pattern: string) {
    this.watcher.unwatch(pattern);
    this.watchingPaths = without(this.watchingPaths, pattern);
  }

  get watched() {
    return this.watchingPaths;
  }
}