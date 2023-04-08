import { createLogger, Medley, Station, StationOptions, StationRegistry, TrackCollection } from "@seamless-medley/core";
import { breath } from "@seamless-medley/utils";
import { config as configDotEnv } from 'dotenv';
import { pickBy, shuffle } from "lodash";
import { musicCollections, sequences, sweeperRules } from "../fixtures";
import { MongoMusicDb } from "../musicdb/mongo";
import { MedleyAutomaton, MedleyAutomatonOptions } from "./automaton";

// TODO: Merge this file with bot_main.ts
// TODO: Support for configuration file (YAML), either via ENV or CLI
// TODO: Support for configurations via ENV

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
});

configDotEnv();

// TODO: centralize environment variable into one place
const musicPath = process.env.MUSIC_PATH || "/musics";
const dropPath = process.env.DROP_PATH || "/drops";

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
      intros: [
        `${dropPath}/Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3`
      ],

      requestSweepers: [
        `${dropPath}/your/Music Radio Creative - Playing All Your Requests.mp3`,
        `${dropPath}/your/Music Radio Creative - Playing Your Favourite Artists.mp3`,
        `${dropPath}/your/Music Radio Creative - Simply Made for You.mp3`
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
      botToken: `${process.env.DISCORD_BOT_TOKEN}`,
      clientId: `${process.env.DISCORD_CLIENT_ID}`,
      baseCommand: `${process.env.DISCORD_BASE_COMMAND}`
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
  const logger = createLogger({ name: 'main' });
  const info = Medley.getInfo();

  logger.info('NodeJS version', process.version);
  logger.info(`node-medley version: ${info.version.major}.${info.version.minor}.${info.version.patch}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);
  logger.info('Initializing');

  logger.debug(`----- MONGO DB Configuration from env`);
  logger.debug(pickBy(process.env, (v, k) => {
    return k.startsWith('MONGO_');
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

  const automatons = await Promise.all(storedConfigs.automatons.map(({ id, botToken, clientId, baseCommand }) => new Promise<MedleyAutomaton>(async (resolve) => {
    const automaton = new MedleyAutomaton(stationRepo, {
      id,
      botToken,
      clientId,
      baseCommand
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
