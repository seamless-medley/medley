import http from 'http';
import express from 'express';
import { SocketServer as IOServer } from '../socket';
import { Server } from './socket-server';

async function run() {
  const app = express();
  const httpServer = http.createServer(app);
  const ioServer = new IOServer(httpServer, '/socket.io');

  const server = new Server(ioServer);

  const port = +(process.env.PORT || 3001);
  httpServer.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}

run();
