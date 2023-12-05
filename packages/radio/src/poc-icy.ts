import { Station } from "@seamless-medley/core";
import http from 'http';
import express from 'express';
import { IcyAdapter } from "./streaming";
import { MongoMusicDb } from "./musicdb/mongo";
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
    .name('poc-icy')
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

  const adapters = await Promise.all(stations.map(async (station) => {
    const adapter = new IcyAdapter(station, {
      outputFormat: 'mp3',
      bitrate: 128,
      sampleRate: 48000
    });

    await adapter.init();

    return adapter;
  }));

  if (adapters.length) {
    const app = express();

    const port = +(process.env.PORT || 4000);
    const server = http.createServer(app);

    for (const adapter of adapters) {
      app.get(`/${adapter.station.id}`, adapter.handler);
      adapter.station.start();
    }

    server.listen(port, () => {
      logger.info(`Listening on ${port}`);
    });
  }
}

main();
