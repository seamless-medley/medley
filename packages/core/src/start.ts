import { Medley, Queue } from "@medley/medley";
import { every, first } from "lodash";
import { join as joinPath } from "path";
import { BoomBox, BoomBoxMetadata } from "./boombox";
import { TrackCollection, WatchTrackCollection } from "./collections";
import { Crate } from "./crate";
import { lyricsToText, parse as parseLyrics } from "./lyrics";

const collections: Map<string, TrackCollection<BoomBoxMetadata>> = new Map(
  ['bright', 'chill', 'lovesong', 'lonely', 'brokenhearted', 'hurt', 'upbeat']
    .map(sub => [sub, WatchTrackCollection.initWithWatch<BoomBoxMetadata>(sub, joinPath(`D:\\vittee\\Google Drive\\musics\\`, sub))])
);

const sequences: [string, number][] = [
  ['bright', 3],
  ['chill', 3],
  ['lovesong', 3],
  ['lonely', 2],
  ['brokenhearted', 1],
  ['hurt', 1],
  ['brokenhearted', 1],
  ['lonely', 1],
  ['lovesong', 1],
  ['chill', 2],
  ['bright', 2],
  ['upbeat', 2]
];

const queue = new Queue();
const medley = new Medley(queue);
const crates = sequences.map(([id, max]) => new Crate(`${id}-${max}`, collections.get(id)!, max));
const boombox = new BoomBox({
  medley,
  queue,
  crates
});

boombox.on('currentCrateChange', (oldCrate, newCrate) => {
  console.log('New crate!!');
});

boombox.on('trackStarted', track => {
  console.log('Playing:', `${track.metadata?.tags?.artist} - ${track.metadata?.tags?.title}`);
  const lyrics = first(track.metadata?.tags?.lyrics);
  if (lyrics) {
    console.log(lyricsToText(parseLyrics(lyrics.toString())));
  }
});

setTimeout(function playWhenReady() {
  if (every([...collections.values()], col => col.ready)) {
    medley.play();
    return;
  }
  setTimeout(playWhenReady, 100);
}, 100);