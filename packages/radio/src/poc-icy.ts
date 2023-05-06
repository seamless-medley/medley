import { Station } from "@seamless-medley/core";
import http from 'http';
import express from 'express';
import { IcyAdapter } from "./streaming";
import { MongoMusicDb } from "./musicdb/mongo";
import { musicCollections, sequences, sweeperRules } from "./fixtures";

process.on('uncaughtException', (e) => {

});

async function main() {
  const app = express();

  const port = +(process.env.PORT || 4000);
  const server = http.createServer(app);

  const musicDb = await new MongoMusicDb().init({
    url: 'mongodb://root:example@localhost:27017',
    database: 'medley',
    ttls: [60 * 60 * 24 * 7, 60 * 60 * 24 * 12]
  });

  const station = new Station({
    id: 'default',
    name: 'Default station',
    useNullAudioDevice: true,
    musicDb
  });

  for (const desc of musicCollections) {
    if (!desc.auxiliary) {
      await station.addCollection(desc);
    }
  }

  station.updateSequence(sequences);
  station.sweeperInsertionRules = sweeperRules;

  const source = new IcyAdapter(station, {
    outputFormat: 'mp3',
    bitrate: 128,
    sampleRate: 48000
  });

  if (source) {
    await source.init();
    app.get('/test', source.handler);

    server.listen(port, () => {
      console.log('Listening on', port);
    });
  }

  station.playIfHasAudiences();
}

main();
