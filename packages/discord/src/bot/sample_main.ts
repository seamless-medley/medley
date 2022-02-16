import { BoomBoxTrack, TrackCollection, WatchTrackCollection } from "@seamless-medley/core";
import _ from "lodash";
import { MedleyAutomaton } from "./automaton";
import { Station } from "./mix";

process.on('uncaughtException', (e) => {
  console.error('Exception', e, e.stack);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
});

const station = new Station({
  intros: (() => {
    const collection = new TrackCollection('$_intro');
    collection.add('D:\\vittee\\Desktop\\test-transition\\drops\\Music Radio Creative - This is the Station With All Your Music in One Place 1.mp3');
    return collection;
  })(),

  requestSweepers: WatchTrackCollection.initWithWatch<BoomBoxTrack>('$_req_sweepers', 'D:\\vittee\\Desktop\\test-transition\\drops\\your')
});

station.updateCollections({
  'bright': 'D:\\vittee\\Google Drive\\musics\\bright\\**\\*',
  'brokenhearted': 'D:\\vittee\\Google Drive\\musics\\brokenhearted\\**\\*',
  'chill': 'D:\\vittee\\Google Drive\\musics\\chill\\**\\*',
  'groovy': 'D:\\vittee\\Google Drive\\musics\\groovy\\**\\*',
  'hurt': 'D:\\vittee\\Google Drive\\musics\\hurt\\**\\*',
  'lonely': 'D:\\vittee\\Google Drive\\musics\\lonely\\**\\*',
  'lovesong': 'D:\\vittee\\Google Drive\\musics\\lovesong\\**\\*',
  'upbeat': 'D:\\vittee\\Google Drive\\musics\\upbeat\\**\\*',
  'new-released': 'D:\\vittee\\Google Drive\\musics\\new-released\\**\\*'
});

const sequence: [string, number][] = [
  ['new-released', 1],
  ['bright', 1],
  ['groovy', 1],
  ['chill', 2],
  ['lovesong', 2],
  ['lonely', 1],
  ['brokenhearted', 1],
  ['hurt', 1],
  ['brokenhearted', 1],
  ['lonely', 1],
  ['lovesong', 2],
  ['chill', 2],
  ['new-released', 1],
  ['bright', 1],
  ['upbeat', 1],
  ['groovy', 1],
  ['chill', 2]
]

station.updateSequence(sequence);

station.updateSweeperRules(
  { // Upbeat
    to: ['upbeat', 'bright'],
    path: 'D:\\vittee\\Desktop\\test-transition\\drops\\up'
  },
  { // Easy mood
    to: ['lovesong', 'bright', 'chill'],
    path: 'D:\\vittee\\Desktop\\test-transition\\drops\\easy'
  },
  { // Sad mood
    to: ['lonely', 'brokenhearted', 'hurt'],
    path: 'D:\\vittee\\Desktop\\test-transition\\drops\\blue'
  },
  { // Fresh
    to: ['new-released'],
    path: 'D:\\vittee\\Desktop\\test-transition\\drops\\fresh'
  }
);

station.setCrateIndex(_.random(0, sequence.length));

const automaton = new MedleyAutomaton(station, {
});

automaton.login();