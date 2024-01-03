import { BoomBoxTrackPlay, getTrackBanner, Station, StationEvents, TrackKind } from "@seamless-medley/core";
import axios, { AxiosError } from "axios";
import { chain, noop } from "lodash";
import { pipeline } from "stream";
import { FFMpegCapabilities, FFmpegChildProcess, FFMpegLine, getFFmpegCaps, InfoLine, ProgressValue } from "../ffmpeg";
import { AdapterOptions, audioFormatToAudioType, FFMpegAdapter } from "../types";
import { getVersion } from "../../helper";
import { createLogger, Logger } from "@seamless-medley/logging";

const outputFormats = ['mp3', 'aac', 'he-aac', 'vorbis', 'opus', 'flac'] as const;

type OutputFormats = typeof outputFormats[number];

export type ShoutAdapterOptions = AdapterOptions<OutputFormats> & {
  ffmpegPath?: string;
  icecast: {
    host: string;
    port: number;
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
  #lastInfo?: InfoLine;

  #error?: Error;

  #progress?: ProgressValue;

  #initialized = false;

  #logger: Logger;

  #options: Omit<Required<ShoutAdapterOptions>, 'ffmpegPath' | 'fx'> & {
    fx?: ShoutAdapterOptions['fx']
  };

  #currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

  #karaokeEnabled = false;

  constructor(station: Station, options: ShoutAdapterOptions) {
    super(station, options.ffmpegPath);

    const {
      sampleFormat = 'FloatLE',
      sampleRate = 44100,
      bitrate = 128,
      outputFormat = 'mp3',
      icecast,
      fx
    } = options;

    this.#options = {
      sampleFormat,
      sampleRate,
      bitrate,
      outputFormat,
      icecast: {
        tls: false,
        userAgent: `Medley/${getVersion()}`,
        ...icecast
      },
      fx
    }

    this.#karaokeEnabled = this.#options.fx?.karaoke?.enabled === true;

    const { host, port } = this.#options.icecast;

    this.#logger = createLogger({
      name: 'shout',
      id: `${host}:${port}${this.#getMountPoint()}`
    });

    station.on('deckStarted', this.#handleDeckStarted);
    station.on('trackActive', this.#handleTrackActive);
  }

  override async init(): Promise<void> {
    this.#error = undefined;
    this.#lastInfo = undefined;

    try {
      await super.init();
      await this.overseer?.respawn();
      this.#initialized = true;
    }
    catch (e) {
      this.#error = e as Error;
    }
  }

  get initialized() {
    return this.#initialized;
  }

  get infoLine(): string | undefined {
    return this.#lastInfo?.text;
  }

  get error(): Error | undefined {
    return this.#error;
  }

  get statistics() {
    return this.#progress ?? {
      duration: 0,
      size: 0,
      speed: 0,
      values: {}
    }
  }

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
      ...(bitrate ? ['-b:a', `${bitrate}k`] : []),
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

  protected override async afterSpawn(process: FFmpegChildProcess) {
    if (this.audioRequest?.id) {
      this.station.deleteAudioStream(this.audioRequest.id);
    }

    this.audioRequest = await this.station.requestAudioStream({
      format: this.#options.sampleFormat,
      sampleRate: this.#options.sampleRate,
      bufferSize: this.#options.sampleRate * 2.0,
      buffering: this.#options.sampleRate * 0.25,
      fx: this.#options.fx
    });

    pipeline(this.audioRequest.stream, process.stdin, noop);
  }

  protected override started() {
    this.#logger.debug('Started');
    setTimeout(this.#postMetadata, 2000);
  }

  protected override log(line: FFMpegLine) {
    if (line.type === 'info') {
      this.#lastInfo = line;
      this.#logger.debug(line.text);
      return;
    }

    if (line.type === 'error') {
      this.#error = new Error(line.text);
      this.#logger.error(line.text);
      return;
    }

    if (line.type === 'progress') {
      this.#progress = line.values;
      return;
    }
  }

  #handleDeckStarted: StationEvents['deckStarted'] = (deck, trackPlay) => {
    if (!trackPlay.track.extra) {
      return;
    }

    if (trackPlay.track.extra.kind === TrackKind.Insertion) {
      this.audioRequest?.setFx('karaoke', { enabled: false });
      return;
    }

    this.audioRequest?.setFx('karaoke', { enabled: this.#karaokeEnabled });
  }

  #handleTrackActive: StationEvents['trackActive'] = (deckIndex, trackPlay) => {
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
    const song = getTrackBanner(this.#currentTrackPlay.track);

    this.#logger.debug('Sending metadata to Icecast server: %s', song);

    axios.get(`${tls ? 'https' : 'http'}://${host}:${port}/admin/metadata`, {
      auth: {
        username,
        password
      },
      params: {
        mode: 'updinfo',
        mount: this.#getMountPoint(),
        song,
      },
      headers: {
        'User-Agent': userAgent
      }
    })
    .catch((e: AxiosError) => {
      if (e.code === 'ERR_BAD_REQUEST') {
        this.#logger.error(e, 'Error updating metadata, mount point might not support metadata');
      } else {
        this.#logger.error(e, 'Error updating metadata');
      }
    });
  }

  override stop() {
    if (this.audioRequest?.id) {
      this.station.deleteAudioStream(this.audioRequest.id);
    }

    this.overseer?.stop();

    this.station.off('trackActive', this.#handleTrackActive);
    this.station.off('deckStarted', this.#handleDeckStarted);
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
