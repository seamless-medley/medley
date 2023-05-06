import {
  AudienceType,
  BoomBoxEvents,
  BoomBoxTrackPlay,
  getTrackBanner,
  makeAudienceGroupId,
  RequestAudioStreamResult,
  Station
} from "@seamless-medley/core";

import { RequestHandler } from "express";
import { OutgoingHttpHeaders } from "http";
import { noop, isUndefined, omitBy, } from "lodash";
import { PassThrough, Transform, pipeline } from "stream";
import { FFmpegChildProcess } from "../ffmpeg";
import { AdapterOptions, audioFormatToAudioType, FFMpegAdapter } from "../types";
import { IcyMetadata, MetadataMux } from "./mux";

export const mimeTypes = {
  mp3: 'audio/mpeg',
  adts: 'audio/aac'
}

const outputFormats = ['mp3', 'adts'] as const;

type OutputFormats = typeof outputFormats[number];

export type IcyAdapterOptions = AdapterOptions<OutputFormats> & {
  ffmpegPath?: string;
  metadataInterval?: number;
}

export class IcyAdapter extends FFMpegAdapter {
  constructor(station: Station, options?: IcyAdapterOptions) {
    super(station, options?.ffmpegPath);

    this.#options = {
      sampleFormat: 'FloatLE',
      sampleRate: 44100,
      bitrate: 128,
      outputFormat: 'mp3',
      metadataInterval: 16000,
      ...options ?? {}
    }

    station.on('trackActive', this.#handleTrackActive);
  }

  #options: Required<AdapterOptions<OutputFormats>> & Pick<IcyAdapterOptions, 'metadataInterval'>;

  #currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

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

  #handleTrackActive: BoomBoxEvents['trackActive'] = (deckIndex, trackPlay) => {
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
    const needMetadata = req.headers['icy-metadata'] === '1';

    const url = new URL(req.url, `http://${req.headers.host ?? '0.0.0.0'}`);

    const audienceGroup = makeAudienceGroupId(AudienceType.Icy, `${url.host}${url.pathname}`);
    const audienceId = `${req.ip}:${req.socket.remotePort}`;

    this.station.addAudience(audienceGroup, audienceId);

    if (!this.overseer.running) {
      this.overseer.respawn();
    }

    const transformers: Transform[] = [];
    const mux = new MetadataMux(needMetadata ? this.#options.metadataInterval : 0 ?? 0);
    this.#multiplexers.add(mux);

    transformers.push(mux);

    for (let i = 0; i < transformers.length - 1; i++) {
      transformers[i].pipe(transformers[i + 1]);
    }

    const transport = (buffer: Buffer) => res.write(buffer);

    const valve = {
      in: transformers.at(0)!,
      out: transformers.at(-1)!
    }

    valve.out.on('data', transport);
    this.#outlet.pipe(valve.in);

    req.socket.on('close', () => {
      this.#multiplexers.delete(mux);

      this.#outlet.unpipe(valve.in);

      valve.out.off('data', transport);

      for (let i = 0; i < transformers.length - 1; i++) {
        transformers[i].unpipe(transformers[i + 1]);
      }

      const paused = this.station.removeAudience(audienceGroup, audienceId);
      if (paused) {
        this.overseer.stop();
      }
    });

    const resHeaders: OutgoingHttpHeaders = {
      'Connection': 'close',
      'Content-Type': mimeTypes[this.#options.outputFormat],
      'Cache-Control': 'no-cache, no-store',
      'Server': 'Medley',
      'X-Powered-By': 'Medley',
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

    setTimeout(() => {
      mux.metadata = this.#getIcyMetadata();
    }, 2000);
  }

  get handler(): RequestHandler {
    return this.#handler;
  }

  #audioRequest?: RequestAudioStreamResult;

  protected override async afterSpawn(process: FFmpegChildProcess) {
    if (this.#audioRequest?.id) {
      this.station.deleteAudioStream(this.#audioRequest.id);
    }

    this.#audioRequest = await this.station.requestAudioStream({
      format: this.#options.sampleFormat,
      sampleRate: this.#options.sampleRate,
      bufferSize: this.#options.sampleRate * 2.0,
      buffering: this.#options.sampleRate * 0.25
    });

    pipeline(this.#audioRequest.stream, process.stdin, noop);

    process.stdout.on('data', buffer => this.#outlet.write(buffer));
  }

  override stop() {
    if (this.#audioRequest?.id) {
      this.station.deleteAudioStream(this.#audioRequest.id);
    }

    this.overseer.stop();
    this.#outlet.end();

    this.station.off('trackActive', this.#handleTrackActive);
  }
}

