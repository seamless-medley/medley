import { Station } from "@seamless-medley/core";
import { MongoMusicDb } from "./musicdb/mongo";
import { ShoutAdapter } from "./streaming/shout/adapter";
import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "./config";
import { ZodError } from "zod";
import { createStation } from "./helper";
import { createLogger } from "@seamless-medley/logging";

const logger = createLogger({ name: 'main' });

process.on('uncaughtException', (e) => {
  logger.error(e, 'Exception');
});

process.on('unhandledRejection', (e) => {
  logger.error(e, 'Rejection');
});

async function main() {
  const program = new Command()
    .name('poc-shout')
    .argument('<config-file>')
    .parse(process.argv);

  const configFile = (program.args[0] || '').trim();

  if (!configFile) {
    logger.fatal('No configuration file specified');
    return;
  }

  const configs = await loadConfig(configFile, false);

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

  for (const station of stations) {
    const adapter = new ShoutAdapter(station, {
      outputFormat: 'he-aac',
      bitrate: 256,
      icecast: {
        host: 'localhost',
        mountpoint: `/${station.id}`,
        username: 'othersource',
        password: 'hackmemore',
        userAgent: 'Medley/0.0',
        url: 'https://github.com/seamless-medley/medley',
        name: station.name,
        description: station.description
      }
    });

    station.start();
    await adapter.init();
  };
}

main();
