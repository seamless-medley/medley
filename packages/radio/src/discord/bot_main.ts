import { TrackCollection, createLogger, Station, StationRegistry, StationOptions, MusicLibraryDescriptor, SequenceConfig, breath } from "@seamless-medley/core";
import { MetadataCache } from "@seamless-medley/core";
import _, { noop, shuffle } from "lodash";
import { MedleyAutomaton } from "./automaton";

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Unhandled Rejection', e);
});

type StationConfig = Omit<StationOptions, 'intros' | 'requestSweepers'> & {
  intros?: string[];
  requestSweepers?: string[];
}

type StoredConfig = {
  stations: StationConfig[];
  automatons: any[];
}

const moods = {
  up: ['upbeat', 'bright', 'groovy'],
  easy: ['lovesong', 'chill'],
  sad: ['lonely', 'brokenhearted', 'hurt']
}

const musicCollections: (MusicLibraryDescriptor & { auxiliary?: boolean })[] = [
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

const storedConfigs: StoredConfig = {
  stations: [
    {
      id: 'default',
      name: 'Today FM',
      description: 'Various genres',
      followCrateAfterRequestTrack: true,
      intros: [
        'E:\\medley-drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3',
      ],

      sweeperRules: [
        {
          to: moods.sad,
          path: 'E:\\medley-drops\\to_blue'
        },
        {
          from: moods.sad,
          to: moods.easy,
          path: 'E:\\medley-drops\\blue_to_easy'
        },
        {
          from: moods.sad,
          to: moods.up,
          path: 'E:\\medley-drops\\blue_to_up'
        },
        {
          from: moods.easy,
          to: moods.up,
          path: 'E:\\medley-drops\\easy_to_up'
        },
        {
          from: moods.up,
          to: moods.easy,
          path: 'E:\\medley-drops\\up_to_easy'
        },
        { // Fresh
          to: ['new-released'],
          path: 'E:\\medley-drops\\fresh'
        }
      ],

      requestSweepers: [
        'E:\\medley-drops\\your\\Music Radio Creative - Playing All Your Requests.mp3',
        'E:\\medley-drops\\your\\Music Radio Creative - Playing Your Favourite Artists.mp3',
        'E:\\medley-drops\\your\\Music Radio Creative - Simply Made for You.mp3'
      ]
    },
    // {
    //   id: 'thai',
    //   name: 'Thai',
    //   musicCollections: [
    //     // { id: 'thai', description:'Thai', path: 'M:\\Repository\\th\\Blackhead\\Lossless' },
    //     { id: 'thai', auxiliary: true, description: 'Thai', path: 'M:\\Repository\\th' },
    //     // { id: 'thai', path: 'E:\\medley-xx' }
    //   ],
    //   sequences: [
    //     { crateId: 'thai', collections: [ { id: 'thai' }], limit: 'all' }
    //   ]
    // }
  ],
  automatons: [
    {
      id: 'medley-dev',
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
}

////////////////////////////////////////////////////////////////////////////////////

async function main() {
  const logger = createLogger({ name: 'main' });

  logger.info('Initializing');

  const cache = new MetadataCache();
  await cache.init({
    ttl: 7 * 24 * 60 * 60 * 1000,
    store: {
      type: 'sqlite',
      path: 'metadata.db',
      table: 'tracks'
    }
  });

  const stations = await Promise.all(
    storedConfigs.stations.map(config => new Promise<Station>(async (resolve) => {
      const intros = config.intros ? (() => {
        const collection = new TrackCollection('$_intros');
        collection.add(config.intros);
        return collection;
      })() : undefined;

      const requestSweepers = config.requestSweepers ? (() => {
        const collection = new TrackCollection('$_req_sweepers');
        collection.add(shuffle(config.requestSweepers));
        return collection;
      })() : undefined;

      logger.info('Constructing station:', config.id);

      const station = new Station({
        id: config.id,
        name: config.name,
        description: config.description,
        useNullAudioDevice: true,
        intros,
        requestSweepers,
        followCrateAfterRequestTrack: config.followCrateAfterRequestTrack,
        metadataCache: cache
      });

      for (const desc of musicCollections) {
        if (!desc.auxiliary) {
          await station.library.addCollection(desc);
        }
      }

      station.updateSequence(sequences);
      station.updateSweeperRules(config.sweeperRules || []);

      resolve(station);

      for (const desc of musicCollections) {
        if (desc.auxiliary) {
          await station.library.addCollection(desc);
          await breath();
        }
      }
    }))
  );

  logger.info('Completed stations construction');

  const stationRepo = new StationRegistry(...stations);

  const automatons = await Promise.all(storedConfigs.automatons.map(({ id, botToken, clientId }) => new Promise<MedleyAutomaton>(async (resolve) => {
    // TODO: tuning config
    const automaton = new MedleyAutomaton(stationRepo, {
      id,
      botToken,
      clientId
    });

    logger.info('OAUthURL', automaton.oAuth2Url.toString());

    automaton.once('ready', () => resolve(automaton));

    await automaton.login().catch(noop);
    return automaton;
  })));

  if (automatons.some(a => !a.isReady)) {
    logger.warn('Started, with some malfunctioning automatons');
    return;
  }

  logger.info('Started');
}

main();