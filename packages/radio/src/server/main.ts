import http from 'http';
import express from 'express';
import { ZodError } from "zod";
import { Command } from '@commander-js/extra-typings';
import { Client, GatewayIntentBits } from "discord.js";
import { createLogger, Medley } from '@seamless-medley/core';
import { SocketServer as SocketIOServer } from '../socket';
import { MedleyServer } from './medley-server';
import { AudioServer } from './audio/transport';
import { Config, loadConfig } from '../discord/config';
import { MedleyAutomaton } from '../discord/automaton';

const logger = createLogger({ name: 'main' });

process.on('uncaughtException', (e) => {
  logger.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  logger.error('Rejection', e);
});

////////////////////////////////////////////////////////////////////////////////////

function getVersionLine() {
  const electronVersion = process.versions['electron'];
  const runtime = electronVersion ? 'Electron' : 'NodeJS';
  const version = electronVersion ? `v${electronVersion}` : process.version;

  return `${runtime} version: ${version}; abi=${process.versions.modules}; uv=${process.versions.uv}; v8=${process.versions.v8}`;
}


async function startServer(config: Config) {
  return new Promise<void>((resolve, reject) => {
    const httpServer = http.createServer(express());

    const server = new MedleyServer(
      new SocketIOServer(httpServer, '/socket.io'),
      new AudioServer(httpServer),
      config
    );

    server.once('ready', () => {
      const listenErrorHandler = (e: Error) => {
        reject(e);
      }

      const listeningPort = +(process.env.PORT || config.server?.port || 3001);

      httpServer
        .once('error', listenErrorHandler)
        .listen(listeningPort, () => {
          httpServer.off('error', listenErrorHandler);
          logger.info('Listening on port', listeningPort);

          resolve();
        });
    });
  });
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

  await startServer(configs)
    .catch(e => {
      logger.error('Error starting server,', e.message);
      process.exit(1);
    });

  process.on('SIGINT', () => {
    process.exit(0);
  });
}

main();
