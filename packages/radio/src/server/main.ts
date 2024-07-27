import { createServer } from 'node:net';
import http from 'node:http';
import express from 'express';
import { ZodError } from "zod";
import { Command } from '@commander-js/extra-typings';
import { Client, GatewayIntentBits } from "discord.js";
import { createLogger } from '@seamless-medley/logging';
import { Medley } from '@seamless-medley/core';
import { SocketServer as SocketIOServer } from './socket';
import { MedleyServer } from './medley-server';
import { AudioWebSocketServer } from './audio/ws/server';
import { Config, loadConfig } from '../config';
import { MedleyAutomaton } from '../discord/automaton';
import { RTCTransponder } from './audio/rtc/transponder';
import { getVersionLine, showVersionBanner } from '../helper';
import { extname } from 'node:path';

const logger = createLogger({ name: 'main' });

process.on('uncaughtException', (e) => {
  logger.error(e, 'Exception');
});

process.on('unhandledRejection', (e) => {
  logger.error(e, 'Rejection');
});

////////////////////////////////////////////////////////////////////////////////////

function isPortAvailable(port: number, address?: string) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        probe.close()
          .once('close', () => resolve(true))
      })
      .listen(port, address);
  });
}

async function startServer(configs: Config) {
  return new Promise<[MedleyServer, http.Server]>(async (resolve, reject) => {
    const expressApp = express();
    const httpServer = http.createServer(expressApp);

    const listeningPort = +(process.env.PORT || configs.server?.port || 3001);
    const listeningAddr = (process.env.BIND || configs.server?.address)?.toString();

    if (!await isPortAvailable(listeningPort)) {
      reject(new Error('Address is already in used'));
      return;
    }

    expressApp.use((_, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      next();
    });

    const streamingRouter = express.Router();

    expressApp.use(
      '/streams',
      streamingRouter,
      (_, res) => void res.status(503).end('Unknown stream')
    );

    expressApp.use('/', express.static('dist/ui'), (req, res, next) => {
      const ext = extname(req.path);

      if (!ext) {
        res.sendFile('index.html', {
          root: 'dist/ui',
          dotfiles: 'deny'
        });
        return;
      }

      next();
    });

    const io = new SocketIOServer(httpServer, '/socket.io');
    const audioServer = new AudioWebSocketServer(httpServer, configs.server.audioBitrate * 1000);
    const rtcTransponder = (configs.webrtc)
      ? await new RTCTransponder()
        .initialize(configs.webrtc)
        .catch((error) => {
          reject(error);
          return undefined;
        })
      : undefined;

    const server = new MedleyServer({
      io,
      audioServer,
      rtcTransponder,
      configs
    });

    server.once('ready', () => {
      const listenErrorHandler = (e: Error) => {
        reject(e);
      }

      httpServer
        .once('error', listenErrorHandler)
        .listen(listeningPort, listeningAddr, () => {
          httpServer.off('error', listenErrorHandler);
          logger.info(`Listening on port ${listeningPort}`);

          const { streamers } = server;

          for (const streamer of streamers) {
            if (!streamer.initialized) {
              continue;
            }

            const { httpRouter } = streamer;

            if (httpRouter) {
              streamingRouter.use(httpRouter);
            }

            streamer.start();
          }

          resolve([server, httpServer]);
        });
    });
  });
}

async function main() {
  const program = new Command()
    .name('medley')
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

  const configs = await loadConfig(configFile, false);

  if (configs instanceof Error) {
    logger.fatal('Error loading configurations:');

    if (configs instanceof ZodError) {
      for (const issue of configs.issues) {
        const path = issue.path.join('.') || 'root';
        logger.fatal(`Issue: ${path} - ${issue.message}`)
      }
    } else {
      logger.fatal(configs.message);
    }

    setTimeout(() => process.exit(1), 1e3);
    return;
  }

  logger.info('Initializing');

  try {
    const [medleyServer, httpServer] = await startServer(configs);

    process.on('SIGINT', () => {
      medleyServer.terminate();
      httpServer.close();
      //
      process.exitCode = 0;
      process.kill(process.pid);
    });
  }
  catch (e: any) {
    logger.error(e.stack, 'Error starting server: %s', e.message);
    setTimeout(() => process.exit(1), 1e3);
  }
}

main();
