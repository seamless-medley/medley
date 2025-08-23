/// <reference path="main.d.ts" />

export * from '../core';

import { isString } from 'lodash';
import { extname, resolve as resolvePath } from 'node:path';
import { createServer } from 'node:net';
import http from 'node:http';
import express from 'express';
import session from "express-session";
import { ZodError } from "zod";
import { Command } from '@commander-js/extra-typings';
import { Medley } from '@seamless-medley/medley';
import { AuthData } from '@seamless-medley/remote';
import { createLogger } from '../logging';
import { SocketServer as SocketIOServer } from './socket';
import { MedleyServer } from './medley-server';
import { AudioWebSocketServer } from './audio/ws/server';
import { Config, loadConfig } from '../config';
import { RTCTransponder } from './audio/rtc/transponder';
import { getVersionLine, showVersionBanner } from '../helper';
import { StreamingAdapter } from '../streaming/types';

declare module "express-session" {
  interface SessionData {
    auth: AuthData
  }
}

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
    const listeningPort = +(process.env.PORT || configs.server?.port || 3001);
    const listeningAddr = (process.env.BIND || configs.server?.address)?.toString();

    if (!await isPortAvailable(listeningPort)) {
      reject(new Error('Address is already in used'));
      return;
    }

    const expressApp = express();
    const httpServer = http.createServer(expressApp);

    expressApp.set('trust proxy', 1);

    const sessionMiddleware = session({
      name: 'medley.sid',
      cookie: {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000
      },
      secret: configs.server.secret || 'H0xfTK80tSXDKqWkkAXcCMgPzBz24izI',
      rolling: true,
      resave: true,
      saveUninitialized: true
    });

    expressApp.use(sessionMiddleware);

    expressApp.use((req, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      next();
    });

    const streamingRouter = registerStreamsRoute(expressApp);

    const staticPath = resolvePath(__dirname,
      process.env.NODE_ENV === 'development'
        ? '../../../ui/dist'
        : '../../ui'
    );

    expressApp.use('/', express.static(staticPath), (req, res, next) => {
      const ext = extname(req.path);

      if (!ext) {
        res.sendFile('index.html', {
          root: staticPath,
          dotfiles: 'deny'
        });
        return;
      }

      next();
    });

    const io = new SocketIOServer(httpServer, '/socket.io');
    io.engine.use(sessionMiddleware);

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
      const listenErrorHandler = (e: Error) => reject(e);

      httpServer
        .once('error', listenErrorHandler)
        .listen(listeningPort, listeningAddr, () => {
          httpServer.off('error', listenErrorHandler);

          logger.info(`Listening on port ${listeningPort}`);
          logger.info(`Serving UI at: ${staticPath}`);

          server.streamers.map(streamer => runStream(streamingRouter, streamer));

          resolve([server, httpServer]);
        });
    });
  });
}

export function registerStreamsRoute(app: express.Express, path: string = '/streams') {
  const router = express.Router();

  app.use(
    path, router,
    (_, res) => void res.status(503).end('Unknown stream')
  );

  return router;
}

export function runStream(router: express.Router, streamer: StreamingAdapter<any>) {
  if (!streamer.initialized) {
    return;
  }

  const { httpRouter: streamRouter } = streamer;

  if (streamRouter) {
    const streamPath = streamRouter.stack?.[0]?.route?.path;

    if (streamPath) {
      const registeredRoutes = new Set(router.stack
        .flatMap(layer => (layer.handle as any)?.stack?.[0]?.route?.path)
        .filter(isString)
      );

      if (registeredRoutes.has(streamPath)) {
        logger.warn(`streaming mountpoint ${streamPath} was already registered`);
        return;
      }

      router.use(streamRouter);
    }
  }

  streamer.start();
}

async function main() {
  const program = new Command()
    .name('medley')
    .argument('[config-file]')
    .parse(process.argv);

  const configFile = (program.args[0] || '').trim();

  if (!configFile) {
    logger.fatal('No configuration file specified');
    process.exit(1);
    return;
  }

  const configs = await loadConfig(configFile);

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

  await showVersionBanner('banner.txt');

  const info = Medley.getInfo();

  logger.info(getVersionLine());
  logger.info('node-medley runtime: %s', Object.entries(info.runtime).map(([p, v]) => `${p}=${v}`).join('; '));
  logger.info('node-medley version: %s', `${info.versionString}`);
  logger.info(`JUCE CPU: ${Object.keys(info.juce.cpu)}`);
  logger.info(`UV_THREADPOOL_SIZE: ${process.env.UV_THREADPOOL_SIZE || 4}`);
  logger.info('Initializing');
  logger.flush();

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
