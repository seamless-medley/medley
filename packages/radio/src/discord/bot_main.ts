import { Medley } from '@seamless-medley/medley';
import { Command } from '@commander-js/extra-typings';
import { MongoMusicDb } from "../db/musicdb/mongo";
import { loadConfig } from "../config";
import { ZodError } from "zod";
import { createAutomaton, createStation, getVersionLine, showVersionBanner } from "../helper";
import { createLogger } from "../logging";
import { retryable } from "@seamless-medley/utils";

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
    .argument('[config-file]')
    .parse(process.argv);

  const configFile = (program.args[0] || '').trim();

  if (!configFile) {
    logger.fatal('No configuration file specified');
    process.exit(1);
    return;
  }

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

  await showVersionBanner('banner.txt');

  const info = Medley.getInfo();

  logger.info(getVersionLine());
  logger.info('node-medley runtime: %s', Object.entries(info.runtime).map(([p, v]) => `${p}=${v}`).join('; '));
  logger.info('node-medley version: %s', `${info.versionString}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);
  logger.info(`UV_THREADPOOL_SIZE: ${process.env.UV_THREADPOOL_SIZE || 4}`);
  logger.info('Initializing');
  logger.flush();

  const musicDb = new MongoMusicDb();

  await retryable(async ({ attempts, previousError }) => {
    if (attempts) {
      logger.info('Attempting to re-initialize database connections (%d), previous error was: %s', attempts, (previousError as any).stack);
    }

    return musicDb.init({
      url: configs.db.url,
      database: configs.db.database,
      connectionOptions: configs.db.connectionOptions,
      ttls: [
        configs.db.metadataTTL?.min ?? 60 * 60 * 24 * 7,
        configs.db.metadataTTL?.max ?? 60 * 60 * 24 * 12,
      ]
    });
  },
  {
    wait: 3_000,
    maxWait: 30_000,
    onError: (e) => {
      if (e.msg) {
        logger.error(e.msg);
      }
    }
  });

  const pendingStationIds = new Set(Object.keys(configs.stations));

  const stations = await Promise.all(
    Object.entries(configs.stations).map(async ([stationId, stationConfig]) => {
      logger.info(`Constructing station: ${stationId}`);

      const station = await createStation({
        ...stationConfig,
        id: stationId,
        musicDb,
        onCollectionsScanned() {
          station.logger.info('All collections scanned');

          pendingStationIds.delete(stationId);

          if (pendingStationIds.size === 0) {
            logger.info('All stations scanned');
          }
        },
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

  logger.info('Started');

  process.on('SIGINT', () => {
    process.exitCode = 0;
    process.kill(process.pid);
  });
}

main();
