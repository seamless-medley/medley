import { MusicCollectionDescriptor, SequenceConfig, SweeperInsertionRule, WatchTrackCollection, createLogger } from "@seamless-medley/core";
import normalizePath from "normalize-path";
import { basename } from "path";

const logger = createLogger({
  name: `fixtures`
});

const musicPath = process.env.MUSIC_PATH || "D:\\vittee\\Google Drive\\musics";
logger.debug(`musicPath: ${musicPath}`);

export const musicCollections: MusicCollectionDescriptor[] = [
  { id: 'bright', description: 'Bright', path: `${musicPath}/bright` },
  { id: 'brokenhearted', description: 'Broken Hearted', path: `${musicPath}/brokenhearted` },
  { id: 'chill', description: 'Chill', path: `${musicPath}/chill` },
  { id: 'groovy', description: 'Groovy', path: `${musicPath}/groovy` },
  { id: 'hurt', description: 'Hurt', path: `${musicPath}/hurt` },
  { id: 'lonely', description: 'Lonely', path: `${musicPath}/lonely` },
  { id: 'lovesong', description: 'Love Song', path: `${musicPath}/lovesong` },
  { id: 'joyful', description: 'Joyful', path: `${musicPath}/joyful` },
  { id: 'upbeat', description: 'Upbeat', path: `${musicPath}/upbeat` },
  { id: 'new-released', description: 'New Released', path: `${musicPath}/new-released`, disableLatch: true, noFollowOnRequest: true },
  { id: 'thai', auxiliary: true, description: 'Thai', path: 'M:\\Repository\\th' },
  { id: 'inter', auxiliary: true, description: 'International', path: 'M:\\Repository\\inter' },
];

export const sequences: SequenceConfig[] = [
  { crateId: 'guid1', collections: [{ id: 'new-released' }], chance: 'random', limit: { by: 'one-of', list: [1, 1, 1, 2] } },
  { crateId: 'guid2', collections: [{ id: 'bright' }], chance: { yes: 1, no: 2 }, limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid3', collections: [{ id: 'joyful' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid4', collections: [{ id: 'upbeat' }], chance: { yes: 2, no: 4 }, limit: { by: 'range', range: { min: 1, max: 2 } } },
  { crateId: 'guid5', collections: [{ id: 'groovy' }], chance: { yes: 1, no: 3 }, limit: 1 },
  { crateId: 'guid7', collections: [{ id: 'chill' }], limit: { by: 'range', range: { min: 2, max: 3 } } },
  { crateId: 'guid8', collections: [{ id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  {
    crateId: 'guid9',
    collections: [
      { id: 'lonely', weight: 1 },
      { id: 'brokenhearted', weight: 0.5 }
    ],
    limit: { by: 'upto', upto: 1 }
  },
  { crateId: 'guid10', collections: [{ id: 'brokenhearted' }], limit: { by: 'range', range: { min: 1, max: 2 } } },
  { crateId: 'guid11', collections: [{ id: 'hurt' }], chance: { yes: 1, no: 2 }, limit: { by: 'upto', upto: 1 } },
  { crateId: 'guid12', collections: [{ id: 'lonely' }], limit: { by: 'range', range: { min: 1, max: 2 } } },
  { crateId: 'guid13', collections: [{ id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid14', collections: [{ id: 'chill' }], chance: { yes: 1, no: 1 }, limit: { by: 'upto', upto: 2 } }
];

const makeSweeperRule = (type: string) => {
  const collection = new WatchTrackCollection(type, undefined, {
    trackCreator: async (path) => ({ id: basename(path), path })
  });

  collection.watch(normalizePath(`E:\\medley-drops\\${type}`));

  return collection;
};

const moods = {
  bright: ['bright'],
  up: ['upbeat', 'groovy', 'joyful'],
  easy: ['lovesong', 'chill'],
  sad: ['lonely', 'brokenhearted', 'hurt']
};

export const sweeperRules: SweeperInsertionRule[] = [
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
