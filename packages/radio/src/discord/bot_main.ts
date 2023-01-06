import { TrackCollection, createLogger, Station, StationRegistry, StationOptions } from "@seamless-medley/core";
import { breath } from "@seamless-medley/utils";
import { shuffle } from "lodash";
import { musicCollections, sequences, sweeperRules } from "../fixtures";
import { MongoMusicDb } from "../musicdb/mongo";
import { MedleyAutomaton, MedleyAutomatonOptions } from "./automaton";

process.on('uncaughtException', (e) => {
  console.error('Uncaught Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Unhandled Rejection', e);
});

type StationConfig = Omit<StationOptions, 'intros' | 'requestSweepers' | 'musicIdentifierCache' | 'musicDb'> & {
  intros?: string[];
  requestSweepers?: string[];
}

type StoredConfig = {
  stations: StationConfig[];
  automatons: MedleyAutomatonOptions[];
}

const storedConfigs: StoredConfig = {
  stations: [
    {
      id: 'default-dev',
      name: 'Today FM (Dev)',
      description: 'Various genres',
      followCrateAfterRequestTrack: true,
      intros: [
        'E:\\medley-drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3',
      ],

      requestSweepers: [
        'E:\\medley-drops\\your\\Music Radio Creative - Playing All Your Requests.mp3',
        'E:\\medley-drops\\your\\Music Radio Creative - Playing Your Favourite Artists.mp3',
        'E:\\medley-drops\\your\\Music Radio Creative - Simply Made for You.mp3'
      ]
    },
    {
      id: 'station2-dev',
      name: 'Station 2'
    }
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

  const musicDb = await new MongoMusicDb().init({
    url: 'mongodb://root:example@localhost:27017',
    database: 'medley',
    ttls: [60 * 60 * 24 * 7, 60 * 60 * 24 * 12]
  }).catch(e => console.error(`Could not connect to MongoDB, ${e.message}`));

  if (!musicDb) {
    process.exit(1);
  }

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
        musicDb
      });

      for (const desc of musicCollections) {
        if (!desc.auxiliary) {
          await station.library.addCollection(desc);
        }
      }

      station.updateSequence(sequences);
      station.sweeperInsertionRules = sweeperRules;

      resolve(station);

      for (const desc of musicCollections) {
        if (desc.auxiliary) {
          await station.library.addCollection({
            ...desc,
            newTracksAddingMode: 'append'
          });
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

    await automaton.login();
    return automaton;
  })));

  if (automatons.some(a => !a.isReady)) {
    logger.warn('Started, with some malfunctioning automatons');
    return;
  }

  logger.info('Started');
}

main();
