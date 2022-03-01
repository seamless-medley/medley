import { Medley, Queue } from "@seamless-medley/medley";
import { every } from "lodash";
import { join as joinPath } from "path";
import { BoomBoxTrack, Track } from ".";
import { TrackCollection, WatchTrackCollection } from "./collections";
import { Crate } from "./crate";
import { TrackKind, BoomBox, BoomBoxMetadata } from "./playout";

process.on('uncaughtException', (e) => {
  console.log('Uncaught exception', e);
});

const collections: Map<string, TrackCollection<BoomBoxTrack>> = new Map(
  ['bright', 'chill', 'lovesong', 'lonely', 'brokenhearted', 'hurt', 'upbeat', 'new-released']
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
  ['upbeat', 1],
  ['new-released', 2]
];

const queue = new Queue<BoomBoxTrack>(['D:\\vittee\\Desktop\\test-transition\\drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3']);
const medley = new Medley(queue);
const crates = sequences.map(([id, max], index) => new Crate({
  id: `${index}:${id}-${max}`,
  sources: collections.get(id)!,
  limit: max
}));

const boombox = new BoomBox({
  medley,
  queue,
  crates
});

// const nullDevice = medley.getAvailableDevices().filter(d => d.type == 'Null')[0];
// medley.setAudioDevice({ type: nullDevice.type, device: nullDevice.defaultDevice });

const sweepers = WatchTrackCollection.initWithWatch<BoomBoxTrack>('drops', 'D:\\vittee\\Desktop\\test-transition\\drops');

boombox.sweeperInsertionRules = [
  { // Upbeat
    to: ['upbeat'],
    collection: sweepers
  },
  { // Easy mood
    to: ['lovesong', 'bright', 'chill'],
    collection: sweepers
  },
  { // Sad mood
    to: ['lonely', 'brokenhearted', 'hurt'],
    collection: sweepers
  },
  { // Fresh
    to: ['new-released'],
    collection: sweepers
  }
];

boombox.on('trackQueued', track => {
  console.log('Add to Queue:', track.path);
});

let skipTimer: NodeJS.Timeout;

boombox.on('trackStarted', trackPlay => {
  if (trackPlay.track.metadata?.kind !== TrackKind.Insertion) {
    console.log('Playing:', `${trackPlay.track.metadata?.tags?.artist} - ${trackPlay.track.metadata?.tags?.title}`);
    // const lyrics = first(track.metadata?.tags?.lyrics);
    // if (lyrics) {
    //   console.log(lyricsToText(parseLyrics(lyrics), false));
    // }

    if (skipTimer) {
      clearTimeout(skipTimer);
    }

    skipTimer = setTimeout(() => {
      console.log('Seeking');
      medley.seekFractional(0.75);
    }, 10000);
  }
});

boombox.on('requestTrackFetched', track => {
  const currentKind = boombox.trackPlay?.track.metadata?.kind || TrackKind.Normal;
  if (currentKind !== TrackKind.Request) {
    const sweeper = sweepers.shift();
    if (sweeper) {
      queue.add(sweeper.path);
    }
  }
})

// Test request
// setTimeout(() => {
//   for (let i = 0; i < 2; i++) {
//     const track = collections.get('new-released')!.sample();
//     if (track) {
//       boombox.request(track.path);
//     }
//   }

// }, 5000);

setTimeout(function playWhenReady() {
  if (every([...collections.values()], col => col.ready)) {
    medley.play();
    return;
  }
  setTimeout(playWhenReady, 100);
}, 100);

