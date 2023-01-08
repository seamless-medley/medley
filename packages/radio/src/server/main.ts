import http from 'http';
import express from 'express';
import { SocketServer as SocketIOServer } from '../socket';
import { MedleyServer } from './medley-server';

const port = +(process.env.PORT || 3001);

async function run() {
  const app = express();
  const httpServer = http.createServer(app);

  const listenErrorHandler = (e: Error) => {
    console.error('Error starting server,', e.message);
    process.exit(1);
  }

  console.info('Initializing');

  const ioServer = new SocketIOServer(httpServer, '/socket.io');
  const server = new MedleyServer(ioServer);

  server.once('ready', () => {
    httpServer
      .once('error', listenErrorHandler)
      .listen(port, () => {
        httpServer.off('error', listenErrorHandler);
        console.log(`Listening on port ${port}`);
      });
  });
}

run();
