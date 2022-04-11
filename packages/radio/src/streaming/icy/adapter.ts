import { BoomBoxTrackPlay, getTrackBanner, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { RequestHandler } from "express";
import { OutgoingHttpHeaders } from "http";
import { isUndefined, omitBy, remove } from "lodash";
import { PassThrough, pipeline } from "stream";
import { createFFmpegOverseer } from "../ffmpeg";
import { Adapter, AdapterOptions, audioFormatToAudioType } from "../types";
import { IcyMetadata, MetadataMux } from "./mux";

const outputFormats = ['mp3', 'adts', 'ogg'] as const;

type OutputFormats = typeof outputFormats;

const mimeTypes: Record<OutputFormats[number], string> = {
  mp3: 'audio/mpeg',
  adts: 'audio/x-hx-aac-adts',
  ogg: 'audio/ogg'
}

type IcyAdapterOptions = AdapterOptions<OutputFormats[number]> & {
  metadataInterval?: number;
}

type IcyAdapter = Adapter & {
  handler: RequestHandler
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
      '-ar', sampleRate.toString(),
      '-ac', '2',
      '-i', '-',
      '-f', outputFormat,
      '-b:a', `${bitrate}k`,
      'pipe:1'
    ],

    afterSpawn: async (overseer) => {
      if (audioRequest?.id) {
        station.deleteAudioStream(audioRequest.id);
      }

      audioRequest = await station.requestAudioStream({
        sampleRate,
        format: sampleFormat
      });

      // TODO: Stall detection

      pipeline(audioRequest.stream, overseer.process.stdin, async () => {
        if (stopped) {
          return;
        }

        await overseer.respawn();
      });

      overseer.process.stdout.on('data', buffer => outlet.write(buffer));
    }
  });

  const multiplexers = new Set<MetadataMux>();

  }


  return {
    audioRequest,
    outlet,

    handler(req, res) {
      const needMetadata = req.headers['icy-metadata'] === '1';

      const url = new URL(req.url, `http://${req.headers.host ?? '0.0.0.0'}`);

      const mux = new MetadataMux(metadataInterval);
      multiplexers.add(mux);

      outlet.pipe(mux).pipe(res);

      req.socket.on('close', () => {
        multiplexers.delete(mux);

        mux.unpipe(res);
        outlet.unpipe(mux);
      });
      const resHeaders: OutgoingHttpHeaders = {
        'Connection': 'close',
        'Content-Type': mimeTypes[outputFormat],
        'Server': 'medley',
        'icy-name': station.name,
        'icy-description': station.description,
        'icy-sr': sampleRate,
        'icy-br': bitrate
      };

      if (needMetadata) {
        resHeaders['icy-metaint'] = metadataInterval;
      }

      res.writeHead(200, omitBy(resHeaders, isUndefined));
    },

    stop() {
      stopped = true;

      station.deleteAudioStream(audioRequest.id);
      overseer.kill();
      outlet.end();
    }
  }
}
