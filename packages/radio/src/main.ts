import http from 'http';
import express from 'express';
import { SocketServer, SocketServerController } from './socket';
import { MusicLibrary } from '@seamless-medley/core';

const lib = new MusicLibrary('lib1', undefined);

async function run() {
  const app = express();

  const port = +(process.env.PORT || 3001);
  const server = http.createServer(app);
  const io = new SocketServer(server, '/socket.io');

  const controller = new SocketServerController(io);

  server.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}

run();

// TODO: TrackCollection should be stored globally but separated by its kind
