import { Medley } from "@seamless-medley/core";
import { Client, GatewayIntentBits } from "discord.js";
import { Command } from '@commander-js/extra-typings';
import { MongoMusicDb } from "../musicdb/mongo";
import { MedleyAutomaton } from "./automaton";
import { loadConfig } from "../config";
import { ZodError } from "zod";
import { createAutomaton, createStation } from "../helper";
import { createLogger } from "@seamless-medley/logging";

const logger = createLogger({ name: 'main' });

process.on('uncaughtException', (e) => {
  logger.error(e, 'Exception');
});

process.on('unhandledRejection', (e) => {
  logger.error(e, 'Rejection');
});

////////////////////////////////////////////////////////////////////////////////////

function getVersionLine() {
  const electronVersion = process.versions['electron'];
  const runtime = electronVersion ? 'Electron' : 'NodeJS';
  const version = electronVersion ? `v${electronVersion}` : process.version;

  return `${runtime} version: ${version}; abi=${process.versions.modules}; uv=${process.versions.uv}; v8=${process.versions.v8}`;
}

async function main() {
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
  logger.info('node-medley runtime: %s', Object.entries(info.runtime).map(([p, v]) => `${p}=${v}`).join('; '));
  logger.info('node-medley version: %s', `${info.version.major}.${info.version.minor}.${info.version.patch}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);

  const configs = await loadConfig(configFile, true);

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
        logger: createLogger({ name: 'automaton', id }),
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
    Object.entries(configs.stations).map(async ([stationId, stationConfig]) => {
      logger.info(`Constructing station: ${stationId}`);

      const station = await createStation({
        ...stationConfig,
        id: stationId,
        musicDb
      });

      return station;
    })
  );

  logger.info('Completed stations construction');

  const automatons = await Promise.all(
    Object.entries(configs.automatons).map(([id, config]) => createAutomaton({
      ...config,
      id,
      createdStations: stations
    }))
  );

  if (automatons.some(a => !a.isReady)) {
    logger.warn('Started, with some malfunctioning automatons');
  } else {
    logger.info('Started');
  }

  process.on('SIGINT', () => {
    process.exit(0);
  });
}

main();
