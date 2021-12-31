import { BoomBoxTrack, WatchTrackCollection } from "@seamless-medley/core";
import _ from "lodash";
import { MedleyAutomaton } from "./automaton";
import { MedleyMix } from "./mix";

process.on('uncaughtException', (e) => {
  console.error('Exception', e);
});

process.on('unhandledRejection', (e) => {
  console.error('Rejection', e);
})

const dj = new MedleyMix({
  requestSweepers: WatchTrackCollection.initWithWatch<BoomBoxTrack>('$_req_sweepers', 'D:\\vittee\\Desktop\\test-transition\\drops\\your')
});

dj.updateCollections({
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

dj.updateSequence(sequence);

dj.updateSweeperRules(
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

dj.setCrateIndex(_.random(0, sequence.length));

const automaton = new MedleyAutomaton(dj, {
  botToken: 'OTAwMzU5MTc1MTgyMzgxMDU2.YXAK0w.1qN6P6flRmOhUOLgicAEIe2RQQE',
  clientId: '900359175182381056'
});

automaton.login();