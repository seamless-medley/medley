import {
  AudienceType,
  BoomBoxTrackPlay,
  getTrackBanner,
  makeAudienceGroupId,
  Station,
  StationEvents,
  TrackKind
} from "../../core";

import { RequestHandler, Router } from "express";
import { OutgoingHttpHeaders } from "node:http";
import { noop, isUndefined, omitBy, } from "lodash";
import { PassThrough, Transform, pipeline } from "node:stream";
import { IcyMetadata, MetadataMux } from "./mux";
import { FFmpegChildProcess, FFMpegLine, InfoLine, ProgressValue } from "../ffmpeg";
import { AdapterOptions, audioFormatToAudioType, FFMpegAdapter } from "../types";
import { getVersion } from "../../helper";
import type { RequestAudioStreamResult } from "@seamless-medley/medley";

const mimeTypes = {
  mp3: 'audio/mpeg',
  adts: 'audio/aac'
}

const outputFormats = ['mp3', 'adts'] as const;

type OutputFormats = typeof outputFormats[number];

export type IcyAdapterOptions = AdapterOptions<OutputFormats> & {
  ffmpegPath?: string;
  mountpoint: string;
  metadataInterval?: number;
}

export class IcyAdapter extends FFMpegAdapter {
  #lastInfo?: InfoLine;

  #error?: Error;

  #progress?: ProgressValue;

  #initialized = false;

  #options: Omit<Required<IcyAdapterOptions>, 'ffmpegPath' | 'fx'> & {
    fx?: IcyAdapterOptions['fx'];
  }

  #karaokeEnabled = false;

  #currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

  constructor(station: Station, options: IcyAdapterOptions) {
    super(station, options?.ffmpegPath);

    const { metadataInterval = 16_000, mountpoint, fx, ...restOptions } = options;

    this.#options = {
      sampleFormat: 'FloatLE',
      sampleRate: 44100,
      bitrate: 128,
      outputFormat: 'mp3',
      mountpoint,
      metadataInterval,
      fx,
      ...restOptions
    }

    this.#karaokeEnabled = fx?.karaoke?.enabled === true;

    station.on('deckStarted', this.#handleDeckStarted);
    station.on('trackActive', this.#handleTrackActive);
  }

  override async init(): Promise<void> {
    this.#error = undefined;
    this.#lastInfo = undefined;

    try {
      await super.init();
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

  get statistics(): ProgressValue {
    return this.#progress ?? {
      duration: 0,
      size: 0,
      speed: 0,
      values: {}
    }
  }

  #multiplexers = new Set<MetadataMux>();

  #outlet = new PassThrough();

  protected override async getArgs() {
    const audioType = audioFormatToAudioType(this.#options.sampleFormat);

    return [
      '-f', audioType!,
      '-vn',
      '-ar', `${this.#options.sampleRate}`,
      '-ac', '2',
      '-channel_layout', 'stereo',
      '-i', '-',
      '-f', this.#options.outputFormat,
      '-b:a', `${this.#options.bitrate}k`,
      'pipe:1'
    ]
  }

  #getIcyMetadata(): IcyMetadata | undefined {
    return {
      StreamTitle: this.#currentTrackPlay
        ? getTrackBanner(this.#currentTrackPlay.track)
        : this.station.name
    }
  }

  #handleDeckStarted: StationEvents['deckStarted'] = (deck, trackPlay) => {
    if (!trackPlay.track.extra) {
      return;
    }

    if (trackPlay.track.extra.kind === TrackKind.Insertion) {
      this.#audioRequest?.setFx('karaoke', { enabled: false });
      return;
    }

    this.#audioRequest?.setFx('karaoke', { enabled: this.#karaokeEnabled });
  }

  #handleTrackActive: StationEvents['trackActive'] = (deckIndex, trackPlay) => {
    this.#currentTrackPlay = trackPlay;

    const metadata = this.#getIcyMetadata();

    if (!metadata) {
      return;
    }

    for (const mux of this.#multiplexers) {
      mux.metadata = metadata;
    }
  }

  #handler: RequestHandler = (req, res) => {
    if (!this.overseer) {
      return;
    }

    const needMetadata = req.headers['icy-metadata'] === '1';

    const url = new URL(req.url, `http://${req.headers.host ?? '0.0.0.0'}`);

    const audienceGroup = makeAudienceGroupId(AudienceType.Icy, `${url.host}${url.pathname}`);
    const audienceId = `${req.ip}:${req.socket.remotePort}`;

    this.station.addAudience(audienceGroup, audienceId);

    if (!this.overseer.running) {
      this.overseer.respawn();
    }

    const transformers: Transform[] = [];
    const mux = new MetadataMux(needMetadata ? this.#options.metadataInterval : 0);
    mux.metadata = this.#getIcyMetadata();
    this.#multiplexers.add(mux);

    transformers.push(mux);

    for (let i = 0; i < transformers.length - 1; i++) {
      transformers[i].pipe(transformers[i + 1] as unknown as NodeJS.WritableStream);
    }

    const transport = (buffer: Buffer) => res.write(buffer);

    const valve = {
      in: transformers.at(0)!,
      out: transformers.at(-1)!
    }

    valve.out.on('data', transport);
    this.#outlet.pipe(valve.in  as unknown as NodeJS.WritableStream);

    req.socket.on('close', () => {
      this.#multiplexers.delete(mux);

      this.#outlet.unpipe(valve.in  as unknown as NodeJS.WritableStream);

      valve.out.off('data', transport);

      for (let i = 0; i < transformers.length - 1; i++) {
        transformers[i].unpipe(transformers[i + 1]  as unknown as NodeJS.WritableStream);
      }

      const paused = this.station.removeAudience(audienceGroup, audienceId);
      if (paused) {
        this.overseer?.stop();
      }
    });

    const version = getVersion();

    const resHeaders: OutgoingHttpHeaders = {
      'Connection': 'close',
      'Content-Type': mimeTypes[this.#options.outputFormat],
      'Cache-Control': 'no-cache, no-store',
      'Server': `Medley/${version}`,
      'X-Powered-By': `Medley/${version}`,
      'icy-name': this.station.name,
      'icy-description': this.station.description,
      'icy-sr': this.#options.sampleRate,
      'icy-br': this.#options.bitrate,
      'transfer-encoding': '',
    };

    if (needMetadata) {
      resHeaders['icy-metaint'] = this.#options.metadataInterval;
    }

    res.writeHead(200, omitBy(resHeaders, isUndefined));
  }

  #router?: Router;

  override get httpRouter() {
    if (!this.#router) {
      this.#router = Router();
      this.#router.route(`/icy${this.#options.mountpoint}`).get(this.#handler);
    }

    return this.#router;
  }

  #audioRequest?: RequestAudioStreamResult;

  protected override async afterSpawn(process: FFmpegChildProcess) {
    if (this.#audioRequest?.id) {
      this.station.deleteAudioStream(this.#audioRequest.id);
    }

    this.#audioRequest = await this.station.requestAudioStream({
      format: this.#options.sampleFormat,
      sampleRate: this.#options.sampleRate,
      bufferSize: this.#options.sampleRate * 2.5,
      buffering: this.#options.sampleRate * 0.5,
      fx: this.#options.fx
    });

    pipeline(
      this.#audioRequest.stream as unknown as NodeJS.ReadableStream,
      process.stdin as unknown as NodeJS.WritableStream,
      noop
    );

    process.stdout.on('data', buffer => this.#outlet.write(buffer));
  }

  protected override log(line: FFMpegLine) {
    if (line.type === 'info') {
      this.#lastInfo = line;
      return;
    }

    if (line.type === 'error') {
      this.#error = new Error(line.text);
      return;
    }

    if (line.type === 'progress') {
      this.#progress = line.values;
      return;
    }
  }

  override stop() {
    if (this.#audioRequest?.id) {
      this.station.deleteAudioStream(this.#audioRequest.id);
    }

    this.overseer?.stop();
    this.#outlet.end();

    this.station.off('trackActive', this.#handleTrackActive);
    this.station.off('deckStarted', this.#handleDeckStarted);
  }
}

