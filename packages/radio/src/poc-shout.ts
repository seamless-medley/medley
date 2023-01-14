import { MusicCollectionDescriptor, SequenceConfig, Station, SweeperInsertionRule, WatchTrackCollection } from "@seamless-medley/core";
import normalizePath from "normalize-path";
import { MongoMusicDb } from "./musicdb/mongo";
import { basename } from "path";
import { createShoutAdapter } from "./streaming/shout/adapter";
import { getFFmpegCaps } from "./streaming/ffmpeg";
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

  await createShoutAdapter(station, {
    ffmpegPath: 'D:\\Tools\\ffmpeg\\bin\\ffmpegx',
    outputFormat: 'he-aac',
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

  station.start();
}

async function ff() {
  const ok = await getFFmpegCaps('codecs', 'D:\\Tools\\ffmpeg\\bin\\ffmpeg');
  console.log('RESULT => ', ok);
}

main();
