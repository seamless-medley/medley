import http from 'http';
import express from 'express';
import { SocketServer as IOServer } from '../socket';
import { Server } from './socket-server';

const port = +(process.env.PORT || 3001);

async function run() {
  const app = express();
  const httpServer = http.createServer(app);

  const listenErrorHandler = (e: Error) => {
    console.error('Error starting server,', e.message);
    process.exit(1);
  }

  console.info('Initializing');

  const ioServer = new IOServer(httpServer, '/socket.io');
  const server = new Server(ioServer);

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
