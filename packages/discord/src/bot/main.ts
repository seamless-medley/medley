import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import level from 'level';

async function run() {
  const app = express();

  const port = +(process.env.PORT || 4000);
  const server = http.createServer(app);
  const io = new Server(server);

  server.listen(port, () => {
    console.log('Listening');
  });
}

run();