import { Station } from "@seamless-medley/core";
import { MongoMusicDb } from "./musicdb/mongo";
import { ShoutAdapter } from "./streaming/shout/adapter";
import { musicCollections, sequences, sweeperRules } from "./fixtures";

process.on('uncaughtException', (e) => {
  console.log('Exception', e);
});

async function main() {
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

  const source = new ShoutAdapter(station, {
    // ffmpegPath: 'D:\\Tools\\ffmpeg\\bin\\ffmpeg',
    outputFormat: 'he-aac',
    bitrate: 256,
    icecast: {
      host: 'localhost',
      mountpoint: '/test',
      username: 'othersource',
      password: 'hackmemore',
      userAgent: 'Medley/0.0',
      genre: 'Pop',
      url: 'https://google.com',
      description: 'Hello',
      name: 'My Stream'
    }
  });

  await source.init();

  station.start();
}

main();
