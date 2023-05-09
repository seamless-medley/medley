import { BoomBoxEvents, BoomBoxTrackPlay, getTrackBanner, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import axios, { AxiosError } from "axios";
import { chain, noop } from "lodash";
import { pipeline } from "stream";
import { FFMpegCapabilities, FFmpegChildProcess, FFMpegLine, FFMpegOverseerStartupError, getFFmpegCaps, InfoLine } from "../ffmpeg";
import { AdapterOptions, audioFormatToAudioType, FFMpegAdapter } from "../types";

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

export class ShoutAdapter extends FFMpegAdapter {
  constructor(station: Station, options: ShoutAdapterOptions) {
    super(station, options.ffmpegPath);

    const {
      sampleFormat = 'FloatLE',
      sampleRate = 44100,
      bitrate = 128,
      outputFormat = 'mp3',
      icecast,
    } = options;


    this.#options = {
      sampleFormat,
      sampleRate,
      bitrate,
      outputFormat,
      icecast: {
        port: '8000',
        tls: false,
        userAgent: 'Medley',
        ...icecast
      }
    }

    station.on('trackActive', this.#handleTrackActive);
  }

  override async init(): Promise<void> {
    await super.init();
    await this.overseer.respawn();
  }

  #options: Omit<Required<ShoutAdapterOptions>, 'ffmpegPath'>;

  #currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

  protected override async getArgs() {
    const audioType = audioFormatToAudioType(this.#options.sampleFormat);

    const { sampleRate, bitrate, icecast, outputFormat } = this.#options;
    const { username, password, host, port, tls, userAgent } = icecast;

    return [
      '-f', audioType,
      '-vn',
      '-ar', `${sampleRate}`,
      '-ac', '2',
      '-channel_layout', 'stereo',
      '-i', '-',
      ...await getCodecArgs(outputFormat, await getFFmpegCaps('encoders', this.binPath)),
      '-b:a', `${bitrate}k`,
      '-password', password,
      ...chain(['name', 'description', 'genre', 'url', 'public'])
        .filter(key => key in icecast)
        .flatMap(key => [`-ice_${key}`, (icecast as any)[key]])
        .value(),
      ...(userAgent ? ['-user_agent', userAgent] : []),
      ...(tls ? ['-tls'] : []),
      `icecast://${username}@${host}:${port}${this.#getMountPoint()}`
    ]
  }

  protected override getRespawnDelay() {
    return {
      min: 1000,
      max: 15000
    }
  }

  #audioRequest?: RequestAudioStreamResult;

  protected override async afterSpawn(process: FFmpegChildProcess) {
    if (this.#audioRequest?.id) {
      this.station.deleteAudioStream(this.#audioRequest.id);
    }

    this.#audioRequest = await this.station.requestAudioStream({
      format: this.#options.sampleFormat,
      sampleRate: this.#options.sampleRate
    });

    pipeline(this.#audioRequest.stream, process.stdin, noop);
  }

  protected override started(error?: FFMpegOverseerStartupError) {
    if (error) {
      console.log('Error starting up', error);
      return;
    }

    setTimeout(this.#postMetadata, 2000);
  }

  #lastInfo?: InfoLine;

  protected override log(line: FFMpegLine) {
    if (line.type === 'info') {
      this.#lastInfo = line;
      return;
    }

    if (line.type === 'error') {
      console.log('Error', line, this.#lastInfo);

      return;
    }
  }

  #handleTrackActive: BoomBoxEvents['trackActive'] = (deckIndex, trackPlay) => {
    this.#currentTrackPlay = trackPlay;
    this.#postMetadata();
  }

  #getMountPoint() {
    const { mountpoint } = this.#options.icecast;
    return !mountpoint.startsWith('/') ? `/${mountpoint}` : mountpoint;
  }

  #postMetadata = () => {
    if (!this.#currentTrackPlay) {
      return;
    }

    const { username, password, host, port, tls, userAgent } = this.#options.icecast;

    axios.get(`${tls ? 'https' : 'http'}://${host}:${port}/admin/metadata`, {
      auth: {
        username,
        password
      },
      params: {
        mode: 'updinfo',
        mount: this.#getMountPoint(),
        song: getTrackBanner(this.#currentTrackPlay.track)
      },
      headers: {
        'User-Agent': userAgent
      }
    })
    .catch((e: AxiosError) => {
      if (e.code === 'ERR_BAD_REQUEST') {
        console.error('Error updating metadata, mount point might not support metadata');
      }
    });
  }

  override stop() {
    if (this.#audioRequest?.id) {
      this.station.deleteAudioStream(this.#audioRequest.id);
    }

    this.overseer.stop();

    this.station.off('trackActive', this.#handleTrackActive);
  }
}

async function getCodecArgs(format: OutputFormats, caps?: FFMpegCapabilities<'encoders'>) {
  if (caps && format === 'he-aac') {
    if (!caps.libfdk_aac?.caps?.audio) {
      // fallback to AAC
      format = 'aac';
    }
  }

  switch (format) {
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
}
