import { basename } from "path";
import normalizePath from 'normalize-path';
import { MusicCollectionDescriptor, SequenceConfig, SweeperInsertionRule, WatchTrackCollection } from "@seamless-medley/core";

const moods = {
  bright: ['bright'],
  up: ['upbeat', 'groovy', 'joyful'],
  easy: ['lovesong', 'chill'],
  sad: ['lonely', 'brokenhearted', 'hurt']
}

export const musicCollections: MusicCollectionDescriptor[] = [
  { id: 'bright', description:'Bright', path: 'D:\\vittee\\Google Drive\\musics\\bright' },
  { id: 'brokenhearted', description:'Broken Hearted', path: 'D:\\vittee\\Google Drive\\musics\\brokenhearted' },
  { id: 'chill', description:'Chill', path: 'D:\\vittee\\Google Drive\\musics\\chill' },
  { id: 'groovy', description:'Groovy', path: 'D:\\vittee\\Google Drive\\musics\\groovy' },
  { id: 'hurt', description:'Hurt', path: 'D:\\vittee\\Google Drive\\musics\\hurt' },
  { id: 'lonely', description:'Lonely', path: 'D:\\vittee\\Google Drive\\musics\\lonely' },
  { id: 'lovesong', description:'Love Song', path: 'D:\\vittee\\Google Drive\\musics\\lovesong' },
  { id: 'joyful', description:'Joyful', path: 'D:\\vittee\\Google Drive\\musics\\joyful' },
  { id: 'upbeat', description:'Upbeat', path: 'D:\\vittee\\Google Drive\\musics\\upbeat' },
  { id: 'new-released', description:'New Released', path: 'D:\\vittee\\Google Drive\\musics\\new-released', disableLatch: true, noFollowOnRequest: true },
  { id: 'thai', auxiliary: true, description:'Thai', path: 'M:\\Repository\\th' },
  { id: 'inter', auxiliary: true, description:'International', path: 'M:\\Repository\\inter' },
];

export const sequences: SequenceConfig[] = [
  { crateId: 'guid1', collections: [ { id: 'new-released' }], chance: 'random', limit: { by: 'one-of', list: [1, 1, 1, 2] } },
  { crateId: 'guid2', collections: [ { id: 'bright' }], chance: [1, 2], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid3', collections: [ { id: 'joyful' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid4', collections: [ { id: 'upbeat' }], chance: [2, 4], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid5', collections: [ { id: 'groovy' }], chance: [1, 3], limit: 1 },
  { crateId: 'guid7', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 3] } },
  { crateId: 'guid8', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid9',
    collections: [
      { id: 'lonely', weight: 1 },
      { id: 'brokenhearted', weight: 0.5 }
    ],
    limit: { by: 'upto', upto: 1 }
  },
  { crateId: 'guid10', collections: [ { id: 'brokenhearted' }], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid11', collections: [ { id: 'hurt' }], chance: [1, 2], limit: { by: 'upto', upto: 1 } },
  { crateId: 'guid12', collections: [ { id: 'lonely' }], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid13', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid14', collections: [ { id: 'chill' }], chance: [1, 1], limit: { by: 'upto', upto: 2 } }
];

const makeSweeperRule = (type: string) => {
  const collection = new WatchTrackCollection(type, undefined, {
    trackCreator: async (path) => ({ id: basename(path), path })
  });

  collection.watch(normalizePath(`E:\\medley-drops\\${type}`));

  return collection;
}

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
  },
  {
    from: ['new-released'],
    collection: makeSweeperRule('fresh')
  }
];