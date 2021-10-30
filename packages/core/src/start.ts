import _, { random, range, sample, sampleSize, times, zip } from "lodash";
import { join as joinPath } from "path";
import { Crate, TrackCollection, WatchTrackCollection } from ".";
import { MedleyPlayer } from "./player";

const collections: Map<string, TrackCollection> = new Map(
  ['bright', 'chill', 'lovesong', 'lonely', 'brokenhearted', 'hurt', 'upbeat']
    .map(sub => [sub, WatchTrackCollection.init(joinPath(`D:\\vittee\\Google Drive\\musics\\`, sub))])
);

const sequences: [string, number][] = [
  ['bright', 3],
  ['chill', 3],
  ['lovesong', 3],
  ['lonely', 2],
  ['brokenhearted', 1],
  // ['hurt', 1],
  // ['brokenhearted', 1],
  // ['lonely', 1],
  // ['lovesong', 1],
  // ['chill', 2],
  // ['bright', 2],
  // ['upbeat', 2]
];

const crates = sequences.map(([id, max]) => new Crate(collections.get(id)!, max));
const player = new MedleyPlayer(crates);

const test_adding_crate = false;
if (test_adding_crate) {
  setTimeout(() => {
    const id = sample([...collections.keys()])!;
    const max = random(1, 5);
    console.log(`Inserting a new crate from collection ${id} with maximum of ${max} tracks`);
    crates.push(new Crate(collections.get(id)!, max));
  }, 5000);
}

const test_reset_crates = false;
if (test_reset_crates) {
  setTimeout(() => {
    const newCollectionIds = sampleSize([...collections.keys()], random(2, 5));
    const newSequences = zip(newCollectionIds, times(newCollectionIds.length, () => random(1, 5)));

    console.log('Reset crate', newSequences);

    player.sequencer.crates = newSequences.map(([id, max]) => new Crate(collections.get(id!)!, max!));
  }, 8000);
}

const test_mutate_crates_order = true;
if (test_mutate_crates_order) {
  setTimeout(() => {
    console.log('Swap crates element 1 and 2 directly')
    const n1 = crates[1];
    const n2 = crates[2];

    crates[2] = n1;
    crates[1] = n2;
  }, 8000);
}

player.medley.on('started', () => {
  setTimeout(() => {
    console.log('Force fading to next track');
    player.medley.fadeOut();
  }, 6000);
});

setTimeout(function wait() {
  if (_.every([...collections.values()], col => col.ready)) {
    player.medley.play();
    return;
  }

  setTimeout(wait, 1000);
}, 1000);