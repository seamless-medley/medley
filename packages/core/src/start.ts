import { Medley, Queue } from "@medley/medley";
import { every, shuffle } from "lodash";
import { join as joinPath } from "path";
import { BoomBoxTrack, Track } from ".";
import { BoomBox, BoomBoxMetadata } from "./boombox";
import { TrackCollection, WatchTrackCollection } from "./collections";
import { Crate } from "./crate";
import { lyricsToText, parse as parseLyrics } from "./lyrics";
import { getCuePoints, getMusicMetadata } from "./utils";

process.on('uncaughtException', (e) => {
  console.log('Uncaught exception', e);
});

const collections: Map<string, TrackCollection<BoomBoxTrack>> = new Map(
  ['bright', 'chill', 'lovesong', 'lonely', 'brokenhearted', 'hurt', 'upbeat']
    .map(sub => [sub, WatchTrackCollection.initWithWatch<BoomBoxTrack>(sub, joinPath(`D:\\vittee\\Google Drive\\musics\\`, sub))])
);

const sequences: [string, number][] = [
  ['bright', 1],
  ['chill', 1],
  ['lovesong', 1],
  ['lonely', 1],
  ['brokenhearted', 1],
  ['hurt', 1],
  ['brokenhearted', 1],
  ['lonely', 1],
  ['lovesong', 1],
  ['chill', 1],
  ['bright', 1],
  ['upbeat', 1]
];

const queue = new Queue<BoomBoxTrack>(['D:\\vittee\\Desktop\\test-transition\\drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3']);
const medley = new Medley(queue);
const crates = sequences.map(([id, max], index) => new Crate(`${index}:${id}-${max}`, collections.get(id)!, max));
const boombox = new BoomBox({
  medley,
  queue,
  crates
});

// const nullDevice = medley.getAvailableDevices().filter(d => d.type == 'Null')[0];
// medley.setAudioDevice({ type: nullDevice.type, device: nullDevice.defaultDevice });

const drops = WatchTrackCollection.initWithWatch<Track<BoomBoxMetadata>>('drops', 'D:\\vittee\\Desktop\\test-transition\\drops', {
  newTracksMapper: async tracks => {
    return shuffle(await Promise.all(tracks.map(async track => {
      const musicMetadata = await getMusicMetadata(track.path);

      const cuePoints = (musicMetadata) ? getCuePoints(musicMetadata) : undefined;
      console.log("Drop's meta:", cuePoints);

      const metadata: BoomBoxMetadata = {
        tags: musicMetadata?.common,
        rotation: 'insertion'
      }

      return {
        ...track,
        metadata,
        cueInPosition: cuePoints?.in,
        cueOutPosition: cuePoints?.out,
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

