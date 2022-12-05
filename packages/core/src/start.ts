import normalizePath from "normalize-path";
import { TrackCollection, WatchTrackCollection } from "./collections";
import { InMemoryMusicDb, MusicLibraryDescriptor } from "./library";
import { BoomBoxTrack, SweeperInsertionRule } from "./playout";
import { SequenceConfig, Station } from "./station";
import { breath } from "./utils";

process.on('uncaughtException', (e) => {
  console.log('Uncaught exception', e);
});

const moods = {
  bright: ['bright'],
  up: ['upbeat', 'groovy'],
  easy: ['lovesong', 'chill'],
  sad: ['lonely', 'brokenhearted', 'hurt']
}

const musicCollections: MusicLibraryDescriptor[] = [
  { id: 'bright', description:'Bright', path: 'D:\\vittee\\Google Drive\\musics\\bright' },
  { id: 'brokenhearted', description:'Broken Hearted', path: 'D:\\vittee\\Google Drive\\musics\\brokenhearted' },
  { id: 'chill', description:'Chill', path: 'D:\\vittee\\Google Drive\\musics\\chill' },
  { id: 'groovy', description:'Groovy', path: 'D:\\vittee\\Google Drive\\musics\\groovy' },
  { id: 'hurt', description:'Hurt', path: 'D:\\vittee\\Google Drive\\musics\\hurt' },
  { id: 'lonely', description:'Lonely', path: 'D:\\vittee\\Google Drive\\musics\\lonely' },
  { id: 'lovesong', description:'Love Song', path: 'D:\\vittee\\Google Drive\\musics\\lovesong' },
  { id: 'upbeat', description:'Upbeat', path: 'D:\\vittee\\Google Drive\\musics\\upbeat' },
  { id: 'new-released', description:'New Released', path: 'D:\\vittee\\Google Drive\\musics\\new-released' },
  { id: 'thai', auxiliary: true, description:'Thai', path: 'M:\\Repository\\th' },
];

const sequences: SequenceConfig[] = [
  { crateId: 'guid1', collections: [ { id: 'new-released' }], limit: { by: 'one-of', list: [1, 1, 1, 2] } },
  { crateId: 'guid2', collections: [ { id: 'bright' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid3', collections: [ { id: 'groovy' }], chance: [1, 3], limit: 1 },
  { crateId: 'guid4', collections: [ { id: 'upbeat' }], chance: [2, 8], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid5', collections: [ { id: 'chill' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid6', collections: [ { id: 'lovesong' }], limit: { by: 'range', range: [0, 2] } },
  { crateId: 'guid7',
    collections: [
      { id: 'lonely', weight: 1 },
      { id: 'brokenhearted', weight: 0.5 }
    ],
    limit: { by: 'upto', upto: 1 }
  },
  { crateId: 'guid8', collections: [ { id: 'brokenhearted' }], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid9', collections: [ { id: 'lonely' }], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid10', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid11', collections: [ { id: 'chill' }], chance: [1, 1], limit: { by: 'upto', upto: 2 } }
];

const makeSweeperRule = (type: string) => new WatchTrackCollection(type).watch(normalizePath(`E:\\medley-drops\\${type}/**/*`))

const sweeperRules: SweeperInsertionRule[] = [
  {
    to: moods.sad,
    collection: makeSweeperRule('to_blue')
  },
  {
    from: moods.sad,
    to: moods.easy,
    collection: makeSweeperRule('blue_to_easy')
  },
  {
    from: moods.sad,
    to: moods.up,
    collection: makeSweeperRule('blue_to_up')
  },
  {
    to: moods.up,
    collection: makeSweeperRule('to_up')
  },
  {
    from: [...moods.up, ...moods.bright],
    collection: makeSweeperRule('from_up')
  },
  { // Fresh
    to: ['new-released'],
    collection: makeSweeperRule('fresh')
  }
];

async function main() {

  const station = new Station({
    id: 'default',
    name: 'Default station',
    useNullAudioDevice: false,
    musicDb: new InMemoryMusicDb()
  });

  for (const desc of musicCollections) {
    if (!desc.auxiliary) {
      await station.library.addCollection(desc);
    }
  }

  station.updateSequence(sequences);
  station.sweeperInsertionRules = sweeperRules;

  station.start();

  for (const desc of musicCollections) {
    if (desc.auxiliary) {
      await station.library.addCollection(desc);
      await breath();
    }
  }
}

main();
