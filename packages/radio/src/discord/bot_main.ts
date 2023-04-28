import { createLogger, Medley, Station, StationOptions, StationRegistry, TrackCollection, WatchTrackCollection } from "@seamless-medley/core";
import { breath } from "@seamless-medley/utils";
import { Client, GatewayIntentBits } from "discord.js";
import { Command } from '@commander-js/extra-typings';
import { shuffle } from "lodash";
import { MongoMusicDb } from "../musicdb/mongo";
import { MedleyAutomaton } from "./automaton";
import { loadConfig } from "./config";
import { ZodError } from "zod";
import normalizePath from "normalize-path";

// TODO: Catch signals

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

////////////////////////////////////////////////////////////////////////////////////

function getVersionLine() {
  const electronVersion = process.versions['electron'];
  const runtime = electronVersion ? 'Electron' : 'NodeJS';
  const version = electronVersion ? `v${electronVersion}` : process.version;

  return `${runtime} version: ${version}; abi=${process.versions.modules}; uv=${process.versions.uv}; v8=${process.versions.v8}`;
}

async function main() {
  const logger = createLogger({ name: 'main' });

  const program = new Command()
    .name('medley-discord')
    .argument('<config-file>')
    .option('-r, --register')
    .parse(process.argv);

  const configFile = (program.args[0] || '').trim();

  if (!configFile) {
    logger.fatal('No configuration file specified');
    return;
  }

  const info = Medley.getInfo();

  logger.info(getVersionLine());
  logger.info('node-medley runtime:', Object.entries(info.runtime).map(([p, v]) => `${p}=${v}`).join('; '));
  logger.info('node-medley version:', `${info.version.major}.${info.version.minor}.${info.version.patch}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);

  const configs = await loadConfig(configFile);

  if (configs instanceof Error) {
    logger.fatal('Error loading configurations:');

    if (configs instanceof ZodError) {
      for (const issue of configs.issues) {
        const path = issue.path.join('.') || 'root';
        logger.fatal(`Issue: ${path} - ${issue.message}`)
      }

      return;
    }

    logger.fatal(configs.message);
    return;
  }

  if (program.opts().register) {
    logger.info('Registering');

    for (const [id, { botToken, clientId, baseCommand }] of Object.entries(configs.automatons)) {

      const client = new Client({
        intents: [GatewayIntentBits.Guilds]
      });

      client.login(botToken)

      await MedleyAutomaton.registerGuildCommands({
        botToken,
        clientId,
        logger: createLogger({ name: `automaton/${id}` }),
        baseCommand: baseCommand || 'medley',
        guilds: [...(await client.guilds.fetch()).values()]
      });
    }

    process.exit(0);
  }

  logger.info('Initializing');

  const musicDb = await new MongoMusicDb().init({
    url: configs.db.url,
    database: configs.db.database,
    connectionOptions: configs.db.connectionOptions,
    ttls: [
      configs.db.metadataTTL?.min ?? 60 * 60 * 24 * 7,
      configs.db.metadataTTL?.max ?? 60 * 60 * 24 * 12,
    ]
  });

  const stations = await Promise.all(
    Object.entries(configs.stations).map(([id, stationConfig]) => new Promise<Station>(async (resolve) => {
      const { intros, requestSweepers, musicCollections, sequences, sweeperRules, ...config } = stationConfig;

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

  const automatons = await Promise.all(Object.entries(configs.automatons).map(
    ([id, { botToken, clientId, baseCommand, ...config }]) => new Promise<MedleyAutomaton>(async (resolve) => {
      const automaton = new MedleyAutomaton(stationRepo, {
        id,
        botToken,
        clientId,
        baseCommand,
        trackMessage: config.trackMessage
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
