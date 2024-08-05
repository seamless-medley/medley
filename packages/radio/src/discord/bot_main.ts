import { Medley } from "@seamless-medley/core";
import { Command } from '@commander-js/extra-typings';
import { MongoMusicDb } from "../db/musicdb/mongo";
import { loadConfig } from "../config";
import { ZodError } from "zod";
import { createAutomaton, createStation, getVersionLine, showVersionBanner } from "../helper";
import { createLogger } from "@seamless-medley/logging";

const logger = createLogger({ name: 'main' });

process.on('uncaughtException', (e) => {
  logger.error(e, 'Exception');
});

process.on('unhandledRejection', (e) => {
  logger.error(e, 'Rejection');
});

////////////////////////////////////////////////////////////////////////////////////

async function main() {
  const program = new Command()
    .name('medley-discord')
    .argument('<config-file>')
    .parse(process.argv);

  const configFile = (program.args[0] || '').trim();

  if (!configFile) {
    logger.fatal('No configuration file specified');
    return;
  }

  await showVersionBanner('banner.txt');

  const info = Medley.getInfo();

  logger.info(getVersionLine());
  logger.info('node-medley runtime: %s', Object.entries(info.runtime).map(([p, v]) => `${p}=${v}`).join('; '));
  logger.info('node-medley version: %s', `${info.versionString}`);
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
    process.exit(1);
    return;
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

  (async () => {
    for (const automaton of automatons) {
      await automaton.registerCommandsIfNeccessary();
    }
  })();

  logger.info('Started');

  process.on('SIGINT', () => {
    process.exitCode = 0;
    process.kill(process.pid);
  });
}

main();
