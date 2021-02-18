import { TrackDescriptor } from "@medley/medley";
import chokidar from "chokidar";

export class Track {
  constructor(path: number) {

  }
}

export class TrackCollection extends Array<Track> {

}

// A track collection capable of watching for changes in file system directory
export class WatchTrackCollection extends TrackCollection {
  protected watcher = chokidar.watch([])
    .on('add', path => this.push(path))
    .on('unlink', (path) => {
      let i;
      while ((i = this.indexOf(path)) > -1) {
        this.splice(i, 1);
      }
    })

  watch(dir: string): this {
    this.watcher.add(dir);
    return this;
  }

  unwatch(dir: string) {
    this.watcher.unwatch(dir);
  }

  get watched() {
    return this.watcher.getWatched();
  }
}

export class Library extends WatchTrackCollection {

}

export class Crate {
  constructor(readonly source: TrackCollection, public max: number) {

  }

  next(): Track | undefined {
    const item = this.source.shift();

    if (item) {
      this.source.push(item);
    }

    return item;
  }
}

export class CrateSequence {
  private counter = 0;

  constructor(public crates: Crate[]) {

  }

  nextTrack(): Track {
    if (this.crates.length < 1) {
      throw new Error('No crate');
    }

    let count = this.crates.length;

    while (count-- > 0) {
      const [c] = this.crates;

      const track = c.next();

      if (track) {
        if (++this.counter >= c.max) {
          this.next();
        }

        return track;
      }

      this.next();
    }

    throw new Error('No track');
  }

  private next(): Crate {
    this.counter = 0;

    if (this.crates.length <= 0) {
      throw new Error('There is no crate');
    }

    const c = this.crates.shift()!;
    this.crates.push(c);
    return c;
  }
}