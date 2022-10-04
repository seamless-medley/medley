import { BoomBoxTrackPlay, getTrackBanner, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { pipeline } from "stream";
import axios from "axios";
import { createFFmpegOverseer, InfoLine } from "./streaming/ffmpeg";
import { audioFormatToAudioType } from "./streaming/types";
import { noop } from "lodash";

process.on('uncaughtException', (e) => {

});

const station = new Station({
  id: 'default',
  name: 'Default station',
  useNullAudioDevice: true,
  musicCollections: [
    { id: 'bright', description:'Bright', path: 'D:\\vittee\\Google Drive\\musics\\bright' },
    { id: 'brokenhearted', description:'Broken Hearted', path: 'D:\\vittee\\Google Drive\\musics\\brokenhearted' },
    { id: 'chill', description:'Chill', path: 'D:\\vittee\\Google Drive\\musics\\chill' },
    { id: 'groovy', description:'Groovy', path: 'D:\\vittee\\Google Drive\\musics\\groovy' },
    { id: 'hurt', description:'Hurt', path: 'D:\\vittee\\Google Drive\\musics\\hurt' },
    { id: 'lonely', description:'Lonely', path: 'D:\\vittee\\Google Drive\\musics\\lonely' },
    { id: 'lovesong', description:'Love Song', path: 'D:\\vittee\\Google Drive\\musics\\lovesong' },
    { id: 'upbeat', description:'Upbeat', path: 'D:\\vittee\\Google Drive\\musics\\upbeat' },
    { id: 'new-released', description:'New Released', path: 'D:\\vittee\\Google Drive\\musics\\new-released' },
    // { id: 'thai', auxiliary: true, description:'Thai', path: 'M:\\Repository\\th' },
  ],
  sequences: [
    { crateId: 'guid1', collections: [ { id: 'new-released' }], limit: { by: 'one-of', list: [1, 1, 1, 2] } },
    { crateId: 'guid2', collections: [ { id: 'bright' }], limit: { by: 'upto', upto: 2 } },
    { crateId: 'guid3', collections: [ { id: 'groovy' }], limit: 1 },
    { crateId: 'guid4', collections: [ { id: 'upbeat' }], chance: [2, 8], limit: { by: 'range', range: [1, 2] } },
    { crateId: 'guid5', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 3] } },
    { crateId: 'guid6', collections: [ { id: 'lovesong' }], limit: { by: 'range', range: [0, 2] } },
    { crateId: 'guid7',
      collections: [
        { id: 'lonely', weight: 1 },
        { id: 'brokenhearted', weight: 0.5 }
      ],
      limit: { by: 'upto', upto: 1 }
    },
    { crateId: 'guid8', collections: [ { id: 'brokenhearted' }], limit: { by: 'range', range: [1, 2] } },
    { crateId: 'guid9', collections: [ { id: 'lonely' }], limit: { by: 'range', range: [1, 2] } },
    { crateId: 'guid10', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
    { crateId: 'guid11', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 4] } }
  ],
  sweeperRules: [
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
  ]
});

station.once('ready', async () => {
  const sampleRate = 44100;
  const outputFormat = 'mp3';
  const bitrate = 128;
  const sampleFormat = 'FloatLE';

  const audioType = audioFormatToAudioType(sampleFormat);

  if (!audioType) {
    return;
  }

  const args = [
    '-f', audioType,
    '-vn',
    '-ar', `${sampleRate}`,
    '-ac', '2',
    '-channel_layout', 'stereo',
    '-i', '-',
    '-f', outputFormat,
    // '-c:a', 'libopus',
    '-b:a', `${bitrate}k`,
    '-content_type', 'audio/mpeg',
    'icecast://othersource:hackmemore@localhost:8000/test'
  ];

  let stopped = false;
  let audioRequest!: RequestAudioStreamResult;
  let currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

  function postMetadata() {
    if (!currentTrackPlay) {
      return;
    }

    axios.get('http://localhost:8000/admin/metadata', {
      auth: {
        username: 'othersource',
        password: 'hackmemore'
      },
      params: {
        mode: 'updinfo',
        mount: '/test',
        song: getTrackBanner(currentTrackPlay.track)
      },
      headers: {
        'User-Agent': 'Medley/0.0'
      }
    })
    .catch(noop);
  }

  station.on('trackActive', (deckIndex, trackPlay) => {
    currentTrackPlay = trackPlay;
    postMetadata();
  });

  let lastInfo: InfoLine;

  const overseer = await createFFmpegOverseer({
    args,
    respawnDelay: {
      min: 1000,
      max: 15000
    },
    async afterSpawn(process) {
      audioRequest = await station.requestAudioStream({
        sampleRate,
        format: sampleFormat
      });

      pipeline(audioRequest.stream, process.stdin, noop);
    },

    started(error) {
      if (error) {
        console.log('Error starting up', error);
        return;
      }

      setTimeout(postMetadata, 2000);
    },

    log(line) {
      if (line.type === 'info') {
        lastInfo = line;
        return;
      }

      if (line.type === 'error') {
        console.log('Error', line, lastInfo);

        return;
      }
    }
  });

  // TODO: Add audience

  station.start();
});
