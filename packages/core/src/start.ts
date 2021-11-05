import { Medley, Queue } from "@medley/medley";
import { every, first, shuffle } from "lodash";
import { join as joinPath } from "path";
import { BoomBoxTrack, Track } from ".";
import { BoomBox, BoomBoxMetadata } from "./boombox";
import { TrackCollection, WatchTrackCollection } from "./collections";
import { Crate } from "./crate";
import { lyricsToText, parse as parseLyrics } from "./lyrics";
import { getMusicMetadata } from "./utils";

const collections: Map<string, TrackCollection<BoomBoxTrack>> = new Map(
  ['bright', 'chill', 'lovesong', 'lonely', 'brokenhearted', 'hurt', 'upbeat']
    .map(sub => [sub, WatchTrackCollection.initWithWatch<BoomBoxTrack>(sub, joinPath(`D:\\vittee\\Google Drive\\musics\\`, sub))])
);

const sequences: [string, number][] = [
  ['bright', 1],
  ['chill', 1],
  ['lovesong', 1],
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

const queue = new Queue<BoomBoxTrack>(['D:\\vittee\\Desktop\\test-transition\\drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3']);
const medley = new Medley(queue);
const crates = sequences.map(([id, max]) => new Crate(`${id}-${max}`, collections.get(id)!, max));
const boombox = new BoomBox({
  medley,
  queue,
  crates
});

const drops = WatchTrackCollection.initWithWatch<Track<BoomBoxMetadata>>('drops', 'D:\\vittee\\Desktop\\test-transition\\drops', {
  newTracksMapper: async tracks => {
    return shuffle(await Promise.all(tracks.map(async track => {
      const musicMetadata = await getMusicMetadata(track.path);

      console.log("Drop's meta:", musicMetadata?.common?.title);

      const metadata: BoomBoxMetadata = {
        tags: musicMetadata?.common,
        rotation: 'insertion'
      }

      return {
        ...track,
        metadata,
        cueInPosition: 4.5,
        cueOutPosition: 6.5,
      }
    })));
  }
});

boombox.on('currentCrateChange', (oldCrate, newCrate) => {
  const insertion = drops.shift();
  if (insertion) {
    queue.add(insertion);
    drops.push(insertion);
  }
});

boombox.on('trackQueued', track => {
  console.log('Add to Queue:', track.path);
});

let skipTimer: NodeJS.Timeout;

boombox.on('trackStarted', track => {
  console.log('Playing:', `${track.metadata?.tags?.artist} - ${track.metadata?.tags?.title}`);
  // const lyrics = first(track.metadata?.tags?.lyrics);
  // if (lyrics) {
  //   console.log(lyricsToText(parseLyrics(lyrics), false));
  // }

  if (skipTimer) {
    clearTimeout(skipTimer);
  }

  if (track.metadata?.rotation !== 'insertion') {
    skipTimer = setTimeout(() => {
      console.log('Seeking');
      medley.seekFractional(0.8);
    }, 8000);
  }
});

setTimeout(function playWhenReady() {
  if (every([...collections.values()], col => col.ready)) {
    medley.play();
    return;
  }
  setTimeout(playWhenReady, 100);
}, 100);

