import http from 'http';
import express from 'express';
import { SocketServer as SocketIOServer } from '../socket';
import { MedleyServer } from './medley-server';
import { AudioServer } from './audio/transport';
import { createLogger, Medley } from '@seamless-medley/core';

const logger = createLogger({ name: 'main' });

process.on('uncaughtException', (e) => {
  logger.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  logger.error('Rejection', e);
});

async function start() {
  const info = Medley.getInfo();

  logger.info(getVersionLine());
  logger.info('node-medley runtime:', Object.entries(info.runtime).map(([p, v]) => `${p}=${v}`).join('; '));
  logger.info('node-medley version:', `${info.version.major}.${info.version.minor}.${info.version.patch}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);

  return new Promise<void>((resolve, reject) => {
    const httpServer = http.createServer(express());

    const server = new MedleyServer(
      new SocketIOServer(httpServer, '/socket.io'),
      new AudioServer(httpServer)
    );

    server.once('ready', () => {
      const listenErrorHandler = (e: Error) => {
        reject(e);
      }

      const port = +(process.env.PORT || 3001);

      httpServer
        .once('error', listenErrorHandler)
        .listen(port, () => {
          httpServer.off('error', listenErrorHandler);
          logger.info('Listening on port', port);

          resolve();
        });
    });
  });
}

function getVersionLine() {
  const electronVersion = process.versions['electron'];
  const runtime = electronVersion ? 'Electron' : 'NodeJS';
  const version = electronVersion ? `v${electronVersion}` : process.version;

  return `${runtime} version: ${version}; abi=${process.versions.modules}; uv=${process.versions.uv}; v8=${process.versions.v8}`;
}

async function main() {
  await start()
    .catch(e => {
      logger.error('Error starting server,', e.message);
      process.exit(1);
    });

  logger.info('Initializing');
}

main();
