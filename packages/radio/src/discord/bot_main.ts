import { createLogger, Medley, Station, StationOptions, StationRegistry, TrackCollection, WatchTrackCollection } from "@seamless-medley/core";
import { breath } from "@seamless-medley/utils";
import { Client, GatewayIntentBits } from "discord.js";
import { shuffle } from "lodash";
import { MongoMusicDb } from "../musicdb/mongo";
import { MedleyAutomaton, MedleyAutomatonOptions } from "./automaton";
import { loadConfig } from "./config";
import { ZodError } from "zod";
import normalizePath from "normalize-path";

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
});

type StationConfig = Omit<StationOptions, 'intros' | 'requestSweepers' | 'musicDb'> & {
  intros?: string[];
  requestSweepers?: string[];
};

type StoredConfig = {
  stations: StationConfig[];
  automatons: MedleyAutomatonOptions[];
};

////////////////////////////////////////////////////////////////////////////////////

async function main() {
  const logger = createLogger({ name: 'main' });

  const configFile = (process.argv.at(2) || '').trim();

  if (!configFile) {
    logger.fatal('No configuration file specified');
    return;
  }

  const info = Medley.getInfo();

  logger.info('NodeJS version', process.version);
  logger.info(`node-medley version: ${info.version.major}.${info.version.minor}.${info.version.patch}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);

  const config = await loadConfig(configFile);

  if (config instanceof Error) {
    logger.fatal('Error loading configurations:');

    if (config instanceof ZodError) {
      for (const issue of config.issues) {
        const path = issue.path.join('.') || 'root';
        logger.fatal(`Issue: ${path} - ${issue.message}`)
      }

      return;
    }

    logger.fatal(config.message);
    return;
  }

  if (process.argv[2] === 'register') {
    logger.info('Registering');

    for (const [id, { botToken, clientId, baseCommand }] of Object.entries(config.automatons)) {

      const client = new Client({
        intents: [ GatewayIntentBits.Guilds ]
      });

      client.login(botToken)

      await MedleyAutomaton.registerGuildCommands({
        botToken,
        clientId,
        logger,
        baseCommand: baseCommand || 'medley',
        guilds: [...(await client.guilds.fetch()).values()]
      });
    }

    return;
  }

  logger.info('Initializing');

  const musicDb = await new MongoMusicDb().init({
    url: config.db.url,
    database: config.db.database,
    connectionOptions: config.db.connectionOptions,
    ttls: [
      config.db.metadataTTL?.min ?? 60 * 60 * 24 * 7,
      config.db.metadataTTL?.max ?? 60 * 60 * 24 * 12,
    ]
  });

  const stations = await Promise.all(
    Object.entries(config.stations).map(([id, allConfigs]) => new Promise<Station>(async (resolve) => {
      const { intros, requestSweepers, musicCollections, sequences, sweeperRules, ...config } = allConfigs;

      logger.info('Constructing station:', id);

      const introCollection = intros ? (() => {
        const collection = new TrackCollection('$_intros', undefined);
        collection.add(shuffle(intros));
        return collection;
      })() : undefined;

      const requestSweeperCollection = requestSweepers ? (() => {
        const collection = new TrackCollection('$_req_sweepers', undefined);
        collection.add(shuffle(requestSweepers));
        return collection;
      })() : undefined;

      const station = new Station({
        id,
        ...config,
        intros: introCollection,
        requestSweepers: requestSweeperCollection,
        musicDb,
      });

      for (const [id, desc] of Object.entries(musicCollections)) {
        if (!desc.auxiliary) {
          await station.addCollection({
            id,
            ...desc
          });
        }
      }

      station.updateSequence(sequences.map((s, index) => ({
        crateId: `${index}`,
        ...s
      })));

      station.sweeperInsertionRules = (sweeperRules ?? []).map((rule) => ({
        from: rule.from,
        to: rule.to,
        collection: (() => {
          const c = new WatchTrackCollection(rule.path, undefined);
          c.watch(normalizePath(rule.path));

          return c;
        })()
      }));

      resolve(station);

      for (const [id, desc] of Object.entries(musicCollections)) {
        if (desc.auxiliary) {
          await station.addCollection({
            id,
            ...desc
          });

          await breath();
        }
      }
    }))
  );

  logger.info('Completed stations construction');

  const stationRepo = new StationRegistry(...stations);

  const automatons = await Promise.all(Object.entries(config.automatons).map(
    ([id, { botToken, clientId, baseCommand }]) => new Promise<MedleyAutomaton>(async (resolve) => {
      const automaton = new MedleyAutomaton(stationRepo, {
        id,
        botToken,
        clientId,
        baseCommand
      });

      logger.info('OAUthURL', automaton.oAuth2Url.toString());

      automaton.once('ready', () => resolve(automaton));

      await automaton.login();

      return automaton;
    }))
  );

  if (automatons.some(a => !a.isReady)) {
    logger.warn('Started, with some malfunctioning automatons');
    return;
  }

  logger.info('Started');
}

main();
