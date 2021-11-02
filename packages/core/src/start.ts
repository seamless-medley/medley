import { Medley, Queue } from "@medley/medley";
import { every, random, sample, sampleSize, times, without, zip } from "lodash";
import { join as joinPath } from "path";
import { TrackCollection, WatchTrackCollection } from "./collections";
import { Crate } from "./crate";
import { BoomBox, BoomBoxMetadata } from "./boombox";

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

const test_adding_crate = false;
if (test_adding_crate) {
  setTimeout(() => {
    const id = sample(without([...collections.keys()], 'upbeat'))!;
    const max = random(1, 5);
    console.log(`Inserting a new crate from collection ${id} with maximum of ${max} tracks`);
    crates.push(new Crate(collections.get(id)!, max));

    medley.play();
  }, 5000);
}

const test_reset_crates = false;
if (test_reset_crates) {
  setTimeout(() => {
    const newCollectionIds = sampleSize([...collections.keys()], random(2, 5));
    const newSequences = zip(newCollectionIds, times(newCollectionIds.length, () => random(1, 5)));

    console.log('Reset crate', newSequences);

    boombox.sequencer.crates = newSequences.map(([id, max]) => new Crate(collections.get(id!)!, max!));
    medley.play();
  }, 8000);
}

const test_mutate_crates_order = false;
if (test_mutate_crates_order) {
  setTimeout(() => {
    console.log('Swap crates element 1 and 2 directly')
    const n1 = crates[1];
    const n2 = crates[2];

    crates[2] = n1;
    crates[1] = n2;
  }, 8000);
}

const test_removing_crate = false;
if (test_removing_crate) {
  setTimeout(() => {
    console.log('Making crates[1] to be an invalid crate');
    crates[1] = {} as any;
    crates[99] = new Crate(collections.get('upbeat')!, 2);

    console.log('Crates length', crates.length);
    medley.play();
  }, 8000);
}

// medley.on('started', () => {
//   setTimeout(() => {
//     console.log('Force fading to next track');
//     medley.fadeOut();
//   }, 6000);
// });

boombox.on('currentCrateChange', (oldCrate, newCrate) => {
  console.log('New crate!!');
});

boombox.on('trackStarted', track => console.log('Playing:', `${track.metadata?.artist} - ${track.metadata?.title}`));

setTimeout(function playWhenReady() {
  if (every([...collections.values()], col => col.ready)) {
    medley.play();
    return;
  }

  setTimeout(playWhenReady, 100);
}, 100);