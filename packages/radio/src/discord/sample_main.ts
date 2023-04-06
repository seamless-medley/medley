import {createLogger, Station, StationOptions, StationRegistry, TrackCollection} from "@seamless-medley/core";
import {breath} from "@seamless-medley/utils";
import * as dotenv from 'dotenv';
import _, {shuffle} from "lodash";
import {musicCollections, sequences, sweeperRules} from "../fixtures";
import {MongoMusicDb} from "../musicdb/mongo";
import {MedleyAutomaton, MedleyAutomatonOptions} from "./automaton";

dotenv.config();

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
});

type StationConfig = Omit<StationOptions, 'intros' | 'requestSweepers' | 'musicIdentifierCache' | 'musicDb'> & {
  intros?: string[];
  requestSweepers?: string[];
};

type StoredConfig = {
  stations: StationConfig[];
  automatons: MedleyAutomatonOptions[];
};

const storedConfigs: StoredConfig = {
  stations: [
    {
      id: 'default',
      name: 'Today FM',
      description: 'Various genres',
      followCrateAfterRequestTrack: true,
      // intros: [
      //   'E:\\medley-drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3',
      // ],

      requestSweepers: [
        // 'E:\\medley-drops\\your\\Music Radio Creative - Playing All Your Requests.mp3',
        // 'E:\\medley-drops\\your\\Music Radio Creative - Playing Your Favourite Artists.mp3',
        // 'E:\\medley-drops\\your\\Music Radio Creative - Simply Made for You.mp3'
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
      botToken: 'MTA5MzE0NDg0MjUyMTAzODkzOA.GQr-oW.wDnnEv3eC6AsI8y-CJam7NLjLUXyxvjsL_zigo',
      clientId: '1093144842521038938',
      baseCommand: 'sing'
      // tuning: {
      //   guilds: {
      //     'guild_id1': 'station_id1',
      //     'guild_id2': 'station_id2'
      //   }
      // }
    }
  ]
};

////////////////////////////////////////////////////////////////////////////////////

async function main() {
  const logger = createLogger({name: 'main'});

  logger.info('Initializing');
  logger.debug(`----- MONGO DB Configuration from env`);
  logger.debug(_.pickBy(process.env, (v, k) => {
    return _.startsWith(k, 'MONGO_');
  }));

  const musicDb = await new MongoMusicDb().init({
    url: `mongodb://${process.env.MONGO_DB_USER}:${process.env.MONGO_DB_PASSWORD}@${process.env.MONGO_DB_HOST}:${process.env.MONGO_DB_PORT}`,
    database: `${process.env.MONGO_DB_DATABASE}`,
    ttls: [60 * 60 * 24 * 7, 60 * 60 * 24 * 12]
  });

  const stations = await Promise.all(
    storedConfigs.stations.map(config => new Promise<Station>(async (resolve) => {
      const intros = config.intros ? (() => {
        const collection = new TrackCollection('$_intros', undefined);
        collection.add(config.intros);
        return collection;
      })() : undefined;

      const requestSweepers = config.requestSweepers ? (() => {
        const collection = new TrackCollection('$_req_sweepers', undefined);
        collection.add(shuffle(config.requestSweepers));
        return collection;
      })() : undefined;

      logger.info('Constructing station:', config.id);

      const station = new Station({
        id: config.id,
        name: config.name,
        description: config.description,
        skipCheckAudioDevice: process.env.SKIP_CHECK_AUDIO_DEVICE === "true" || false,
        intros,
        requestSweepers,
        musicDb,
      });

      for (const desc of musicCollections) {
        if (!desc.auxiliary) {
          await station.addCollection(desc);
        }
      }

      station.updateSequence(sequences);
      station.sweeperInsertionRules = sweeperRules;

      resolve(station);

      for (const desc of musicCollections) {
        if (desc.auxiliary) {
          await station.addCollection({
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

  const automatons = await Promise.all(storedConfigs.automatons.map(({id, botToken, clientId}) => new Promise<MedleyAutomaton>(async (resolve) => {
    // TODO: tuning config
    const automaton = new MedleyAutomaton(stationRepo, {
      id,
      botToken,
      clientId
    });

    logger.info('OAUthURL', automaton.oAuth2Url.toString());

    automaton.once('ready', () => resolve(automaton));

    await automaton.login();

    if (process.argv[2] === 'register') {
      await automaton.registerGuildCommands([...(await automaton.client.guilds.fetch()).values()]);
    }

    return automaton;
  })));

  if (automatons.some(a => !a.isReady)) {
    logger.warn('Started, with some malfunctioning automatons');
    return;
  }

  logger.info('Started');
}

main();
