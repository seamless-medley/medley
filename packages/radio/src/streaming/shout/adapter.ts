import { BoomBoxTrackPlay, getTrackBanner, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import axios from "axios";
import { chain, noop } from "lodash";
import { pipeline } from "stream";
import { createFFmpegOverseer, InfoLine } from "../ffmpeg";
import { Adapter, AdapterOptions, audioFormatToAudioType } from "../types";

const outputFormats = ['mp3', 'aac', 'he-aac', 'vorbis', 'opus', 'flac'] as const;

type OutputFormats = typeof outputFormats[number];

export type ShoutAdapterOptions = AdapterOptions<OutputFormats> & {
  ffmpegPath?: string;
  icecast: {
    host: string;
    port?: string;
    tls?: boolean;
    mountpoint: string;
    username: string;
    password: string;
    userAgent?: string;
    name?: string;
    description?: string;
    genre?: string;
    url?: string;
    public?: boolean;
  }
}

export type ShoutAdapter = Adapter & {

}


// TODO: Return ShoutAdapter
export async function createShoutAdapter(station: Station, options: ShoutAdapterOptions): Promise<void> {
  const {
    sampleFormat = 'FloatLE',
    sampleRate = 44100,
    bitrate = 128,
    outputFormat = 'mp3',
    icecast
  } = options ?? {};

  const audioType = audioFormatToAudioType(sampleFormat);

  if (!audioType) {
    return;
  }

  const {
    host,
    port = '8000',
    tls = false,
    username,
    password,
    userAgent = 'Medley'
  } = icecast;

  const mountpoint = (({ mountpoint }) => !mountpoint.startsWith('/') ? `/${mountpoint}` : mountpoint)(icecast);

  let audioRequest!: RequestAudioStreamResult;
  let currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;
  let lastInfo: InfoLine;

  const codecArgs = ((): string[] => {
    switch (outputFormat) {
      case 'mp3':
        return [
          '-f', 'mp3',
          '-content_type', 'audio/mpeg'
        ];

      case 'aac':
        return [
          '-f', 'adts',
          '-content_type', 'audio/aac'
        ];

      case 'he-aac':
        return [
          '-f', 'adts',
          '-c:a', 'libfdk_aac',
          '-profile:a', 'aac_he_v2',
          '-content_type', 'audio/aac'
        ]

      case 'vorbis':
        return [
          '-f', 'ogg',
          '-c:a', 'libvorbis',
          '-content_type', 'audio/ogg'
        ];

      case 'opus':
        return [
          '-f', 'ogg',
          '-c:a', 'libopus',
          '-content_type', 'audio/ogg'
        ];

      case 'flac':
        return [
          '-f', 'ogg',
          '-c:a', 'flac',
          '-content_type', 'application/ogg'
        ]
    }
  })();

  const overseer = await createFFmpegOverseer({
    exePath: options?.ffmpegPath,
    args: [
      '-f', audioType,
      '-vn',
      '-ar', `${sampleRate}`,
      '-ac', '2',
      '-channel_layout', 'stereo',
      '-i', '-',
      ...codecArgs,
      '-b:a', `${bitrate}k`,
      '-password', password,
      ...chain(['name', 'description', 'genre', 'url', 'public'])
        .filter(key => key in icecast)
        .flatMap(key => [`-ice_${key}`, (icecast as any)[key]])
        .value(),
      ...(userAgent ? ['-user_agent', userAgent] : []),
      ...(tls ? ['-tls'] : []),
      `icecast://${username}@${host}:${port}${mountpoint}`
    ],

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

  await overseer.respawn();

  function postMetadata() {
    if (!currentTrackPlay) {
      return;
    }

    axios.get(`${tls ? 'https' : 'http'}://${host}:${port}/admin/metadata`, {
      auth: {
        username,
        password
      },
      params: {
        mode: 'updinfo',
        mount: mountpoint,
        song: getTrackBanner(currentTrackPlay.track)
      },
      headers: {
        'User-Agent': userAgent
      }
    })
    .catch(noop);
  }

  station.on('trackActive', (deckIndex, trackPlay) => {
    currentTrackPlay = trackPlay;
    postMetadata();
  });
}
