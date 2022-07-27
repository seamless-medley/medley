import { AudienceType, BoomBoxTrackPlay, getTrackBanner, makeAudienceGroup, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { RequestHandler } from "express";
import { OutgoingHttpHeaders } from "http";
import _, { isUndefined, noop, omitBy, over } from "lodash";
import { PassThrough, pipeline, Transform } from "stream";
import { createFFmpegOverseer } from "../ffmpeg";
import { Adapter, AdapterOptions, audioFormatToAudioType, mimeTypes } from "../types";
import { IcyMetadata, MetadataMux } from "./mux";

const outputFormats = ['mp3', 'adts'] as const;

type OutputFormats = typeof outputFormats;

type IcyAdapterOptions = AdapterOptions<OutputFormats[number]> & {
  metadataInterval?: number;
}

type IcyAdapter = Adapter & {
  handler: RequestHandler;
}

export async function createIcyAdapter(station: Station, options?: IcyAdapterOptions): Promise<IcyAdapter | undefined> {
  const {
    sampleFormat = 'Int16LE',
    sampleRate = 44100,
    bitrate = 128,
    outputFormat = 'mp3',
    metadataInterval = 16000
  } = options ?? {};

  const audioType = audioFormatToAudioType(sampleFormat);

  if (!audioType) {
    return;
  }

  let stopped = false;
  let audioRequest!: RequestAudioStreamResult;

  const outlet = new PassThrough();

  const overseer = await createFFmpegOverseer({
    args: [
      '-f', audioType!,
      '-vn',
      '-ar', `${sampleRate}`,
      '-ac', '2',
      '-channel_layout', 'stereo',
      '-i', '-',
      '-f', outputFormat,
      '-b:a', `${bitrate}k`,
      'pipe:1'
    ],

    afterSpawn: async (process) => {
      if (audioRequest?.id) {
        station.deleteAudioStream(audioRequest.id);
      }

      audioRequest = await station.requestAudioStream({
        sampleRate,
        format: sampleFormat
      });

      stopped = false;

      pipeline(audioRequest.stream, process.stdin, noop);

      process.stdout.on('data', buffer => outlet.write(buffer));
    }
  });

  let currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;
  const multiplexers = new Set<MetadataMux>();

  function getIcyMetadata(): IcyMetadata | undefined {
    return {
      StreamTitle: currentTrackPlay ? getTrackBanner(currentTrackPlay.track) : station.name
    }
  }

  function handleTrackActive(trackPlay: BoomBoxTrackPlay) {
    currentTrackPlay = trackPlay;

    const metadata = getIcyMetadata();

    if (!metadata) {
      return;
    }

    for (const mux of multiplexers) {
      mux.metadata = metadata;
    }
  }

  station.on('trackActive', handleTrackActive);

  return {
    audioRequest,
    outlet,

    handler(req, res) {
      const needMetadata = req.headers['icy-metadata'] === '1';

      const url = new URL(req.url, `http://${req.headers.host ?? '0.0.0.0'}`);

      const audienceGroup = makeAudienceGroup(AudienceType.Icy, `${url.host}${url.pathname}`);
      const audienceId = `${req.ip}:${req.socket.remotePort}`;

      station.addAudiences(audienceGroup, audienceId, { req, res });

      if (!overseer.running) {
        overseer.respawn();
      }

      currentTrackPlay = station.trackPlay;

      const transformers: Transform[] = [];

      const mux = new MetadataMux(needMetadata ? metadataInterval : 0);
      multiplexers.add(mux);

      transformers.push(mux);

      for (let i = 0; i < transformers.length - 1; i++) {
        transformers[i].pipe(transformers[i + 1]);
      }

      const first = _.first(transformers)!;
      const last = _.last(transformers)!;

      outlet.pipe(first);
      last.pipe(res);

      req.socket.on('close', () => {
        multiplexers.delete(mux);

        for (let i = 0; i < transformers.length - 1; i++) {
          transformers[i].unpipe(transformers[i + 1]);
        }

        outlet.unpipe(first);
        last.unpipe(res);

        const paused = station.removeAudience(audienceGroup, audienceId);
        if (paused) {
          overseer.stop();
        }
      });

      const resHeaders: OutgoingHttpHeaders = {
        'Connection': 'close',
        'Content-Type': mimeTypes[outputFormat],
        'Cache-Control': 'no-cache, no-store',
        'Server': 'medley',
        'X-Powered-By': 'medley',
        'icy-name': station.name,
        'icy-description': station.description,
        'icy-sr': sampleRate,
        'icy-br': bitrate,
        'transfer-encoding': '',
      };

      if (needMetadata) {
        resHeaders['icy-metaint'] = metadataInterval;
      }

      res.writeHead(200, omitBy(resHeaders, isUndefined));

      setTimeout(() => {
        mux.metadata = getIcyMetadata();
      }, 2000);
    },

    stop() {
      stopped = true;

      station.deleteAudioStream(audioRequest.id);
      overseer.stop();
      outlet.end();

      station.off('trackActive', handleTrackActive);
    }
  }
}
