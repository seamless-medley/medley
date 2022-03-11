import { decibelsToGain, Library, TrackCollection } from "@seamless-medley/core";
import _ from "lodash";
import { MedleyAutomaton } from "./automaton";
import { SequenceConfig, Station, SweeperConfig } from "./station";

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
});

const storedConfigs = {
  stations: [
    {
      id: 'default',
      initialGain: decibelsToGain(-15),
      intros: [
        'D:\\vittee\\Desktop\\test-transition\\drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3',
      ],
      musicCollections: [
        { id: 'bright', description:'Bright', path: 'D:\\vittee\\Google Drive\\musics\\bright' },
        { id: 'brokenhearted', description:'Broken Hearted', path: 'D:\\vittee\\Google Drive\\musics\\brokenhearted' },
        { id: 'chill', description:'Chill', path: 'D:\\vittee\\Google Drive\\musics\\chill' },
        { id: 'groovy', description:'Groovy', path: 'D:\\vittee\\Google Drive\\musics\\groovy' },
        { id: 'hurt', description:'Hurt', path: 'D:\\vittee\\Google Drive\\musics\\hurt' },
        { id: 'lonely', description:'Lonely', path: 'D:\\vittee\\Google Drive\\musics\\lonely' },
        { id: 'lovesong', description:'Love Song', path: 'D:\\vittee\\Google Drive\\musics\\lovesong' },
        { id: 'upbeat', description:'Bright', path: 'D:\\vittee\\Google Drive\\musics\\upbeat' },
        { id: 'new-released', description:'New Released', path: 'D:\\vittee\\Google Drive\\musics\\new-released' }
      ],
      sequences: [
        { crateId: 'guid1', collections: [ { id: 'new-released' }], limit: [0, 2] },
        { crateId: 'guid2', collections: [ { id: 'bright' }], limit: [2] },
        { crateId: 'guid3', collections: [ { id: 'groovy' }], limit: 1 },
        { crateId: 'guid4', collections: [ { id: 'chill' }], limit: [2, 3] },
        { crateId: 'guid5', collections: [ { id: 'lovesong' }], limit: [2, 3] },
        { crateId: 'guid6',
          collections: [
            { id: 'lonely', weight: 1 },
            { id: 'brokenhearted', weight: 0.5 }
          ],
          limit: [2]
        },
        { crateId: 'guid7',
          collections: [
            { id: 'hurt', weight: 0.3 },
            { id: 'brokenhearted', weight: 0.6 },
            { id: 'lonely', weight: 0.1 },
          ],
          limit: [3, 5]
        },
        { crateId: 'guid8', collections: [ { id: 'lonely' }], limit: 1 },
        { crateId: 'guid9', collections: [ { id: 'lovesong' }], limit: [2] },
        { crateId: 'guid10', collections: [ { id: 'chill' }], limit: [2, 4] }
      ] as SequenceConfig[],

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
      ] as SweeperConfig[],

      requestSweepers: [
        'D:\\vittee\\Desktop\\test-transition\\drops\\your\\Music Radio Creative - Playing All Your Requests.mp3',
        'D:\\vittee\\Desktop\\test-transition\\drops\\your\\Music Radio Creative - Playing Your Favourite Artists.mp3',
        'D:\\vittee\\Desktop\\test-transition\\drops\\your\\Music Radio Creative - Simply Made for You.mp3'
      ]
    }
  ],
  automatons: [
    {
      botToken: '',
      clientId: '',
      tuning: {
        guilds: {
          'guild_id1': 'station_id1',
          'guild_id2': 'station_id2'
        }
      }
    }
  ]
};

////////////////////////////////////////////////////////////////////////////////////


const stations = new Collection<Station>();
for (const { id, musicCollections, sequences, intros } of storedConfigs.stations) {
  const introsCollection = new TrackCollection('$_intro');
  introsCollection.add(intros);

  const station = new Station({
    id,
    intros: introsCollection,
    musicCollections,
    sequences
  });

  station.updateSweeperRules([
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
  ]);

  station.crateIndex = _.random(0, sequences.length);

  stations.add(station);
}

const automatons: MedleyAutomaton[] = [];
for (const { botToken, clientId } of storedConfigs.automatons) {

  const automaton = new MedleyAutomaton(stations, {
    botToken,
    clientId
  });

  automaton.login();

  automatons.push(automaton);
}