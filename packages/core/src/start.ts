import { Station } from "./station";

process.on('uncaughtException', (e) => {
  console.log('Uncaught exception', e);
});

const station = new Station({
  id: 'default',
  name: 'Default station',
  useNullAudioDevice: false,
  musicCollections: [
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
  ],
  sequences: [
    { crateId: 'guid1', collections: [ { id: 'new-released' }], limit: { by: 'one-of', list: [1, 1, 1, 2] } },
    { crateId: 'guid2', collections: [ { id: 'bright' }], limit: { by: 'upto', upto: 2 } },
    { crateId: 'guid3', collections: [ { id: 'groovy' }], limit: 1 },
    { crateId: 'guid4', collections: [ { id: 'upbeat' }], chance: [2, 8], limit: { by: 'range', range: [1, 2] } },
    { crateId: 'guid5', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 3] } },
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
    { crateId: 'guid11', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 4] } }
  ],
  sweeperRules: [
    { // Upbeat
      to: ['upbeat', 'bright'],
      path: 'D:\\vittee\\Desktop\\test-transition\\drops\\up'
    },
    { // Easy mood
      to: ['lovesong', 'bright', 'chill'],
      path: 'D:\\vittee\\Desktop\\test-transition\\drops\\easy'
    },
    { // Sad mood
      to: ['lonely', 'brokenhearted', 'hurt'],
      path: 'D:\\vittee\\Desktop\\test-transition\\drops\\blue'
    },
    { // Fresh
      to: ['new-released'],
      path: 'D:\\vittee\\Desktop\\test-transition\\drops\\fresh'
    }
  ]
});

station.once('ready', () => station.start());
