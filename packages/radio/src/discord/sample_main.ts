import { createLogger, Station, StationOptions, StationRegistry, TrackCollection } from "@seamless-medley/core";
import { MetadataCache } from "@seamless-medley/core/src/playout/metadata/cache";
import _, { noop, shuffle } from "lodash";
import { MedleyAutomaton } from "./automaton";

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
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
const storedConfigs: StoredConfig = {
  stations: [
    {
      id: 'default',
      name: 'Today FM',
      description: 'Various genres',
      // intros: [
      //   'E:\\medley-drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3',
      // ],
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
        { id: 'inter', auxiliary: true, description:'inter', path: 'M:\\Repository\\inter' },
      ],
      sequences: [
        { crateId: 'guid1', collections: [ { id: 'new-released' }], limit: { by: 'one-of', list: [1, 1, 1, 2] } },
        { crateId: 'guid2', collections: [ { id: 'bright' }], limit: { by: 'upto', upto: 2 } },
        { crateId: 'guid3', collections: [ { id: 'groovy' }], limit: 1 },
        { crateId: 'guid4', collections: [ { id: 'upbeat' }], chance: [2, 8], limit: { by: 'range', range: [1, 2] } },
        { crateId: 'guid5', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 3] } },
        { crateId: 'guid6', collections: [ { id: 'lovesong' }], limit: { by: 'range', range: [2, 3] } },
        { crateId: 'guid7',
          collections: [
            { id: 'lonely', weight: 1 },
            { id: 'brokenhearted', weight: 0.5 }
          ],
          limit: { by: 'upto', upto: 1 }
        },
        { crateId: 'guid8', collections: [ { id: 'brokenhearted' }], limit: { by: 'range', range: [1, 2] } },
        { crateId: 'guid8_1', collections: [ { id: 'hurt' }], chance: [1, 2], limit: { by: 'upto', upto: 1 } },
        { crateId: 'guid9', collections: [ { id: 'lonely' }], limit: { by: 'range', range: [1, 2] } },
        { crateId: 'guid10', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
        { crateId: 'guid11', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 4] } }
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
    //     { id: 'thai', auxiliary: true, description: 'Thai', path: 'M:\\Repository\\th' },
    //   ],
    //   sequences: [
    //     { crateId: 'thai', collections: [ { id: 'thai' }], limit: Infinity }
    //   ]
    // }
  ],
  automatons: [
    {
      id: 'medley',
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
    store: {
      type: 'sqlite',
      path: 'metadata.db',
      table: 'tracks'
    }
  });

  const stations = await Promise.all(
    storedConfigs.stations.map(config => new Promise<Station>((resolve) => {
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
        intros,
        requestSweepers,
        musicCollections: config.musicCollections,
        sweeperRules: config.sweeperRules,
        sequences: config.sequences,
        metadataCache: cache
      });

      // stations.add(station);

      station.once('ready', () => resolve(station));
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