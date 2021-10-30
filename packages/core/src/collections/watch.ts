import chokidar from "chokidar";
import { debounce, reject, shuffle } from "lodash";
import { Track } from "../track";
import { TrackCollection, TrackCollectionOptions } from "./base";



// A track collection capable of watching for changes in file system directory
export class WatchTrackCollection<M = void> extends TrackCollection<M> {
  static initWithWatch<M>(paths: string, options: TrackCollectionOptions<M> = {}): WatchTrackCollection<M> {
    const inst = new WatchTrackCollection<M>(options);
    inst.watch(paths);
    return inst;
  }

  constructor(options: TrackCollectionOptions<M> = {}) {
    super({
      newTracksMapper: shuffle,
      ...options
    });
  }

  protected afterConstruct() {

  }

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
    this.emit('store', newTracks);
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

  watch(paths: string): this {
    this.watcher.add(paths);
    return this;
  }

  unwatch(paths: string) {
    this.watcher.unwatch(paths);
  }

  get watched() {
    return Object.keys(this.watcher.getWatched());
  }
}