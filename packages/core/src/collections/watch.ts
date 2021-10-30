import { Track } from "../track";
import { TrackCollection } from "./base";
import chokidar from "chokidar";
import { debounce, reject, shuffle, uniq } from "lodash";

// A track collection capable of watching for changes in file system directory
export class WatchTrackCollection<M = void> extends TrackCollection<M> {
  static init<M>(paths: string): WatchTrackCollection<M> {
    const inst = new WatchTrackCollection<M>();
    inst.watch(paths);
    return inst;
  }

  protected afterConstruct() {

  }

  private newPaths: string[] = [];

  private fetchNewPaths() {
    const result = this.newPaths;
    this.newPaths = [];
    // TODO: Call an external function for mapping all collect paths into another list
    return shuffle(result);
  }

  private storeNewTracks = debounce(() => {
    const newTracks = this.fetchNewPaths();
    console.log('storeNewTrack', newTracks);
    this.add(newTracks);
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
      this.tracks = reject(this.tracks, t => t.path === path);
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