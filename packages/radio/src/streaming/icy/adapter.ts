import { RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { RequestHandler } from "express";
import { noop } from "lodash";
import { PassThrough, pipeline } from "stream";
import { FFmpegChildProcess, spawnFFmpeg } from "../ffmpeg";
import { Adapter, AdapterOptions, audioFormatToAudioType } from "../types";

type IcyAdapter = Adapter & {
  handler: RequestHandler
}

export async function createIcyAdapter(station: Station, options?: AdapterOptions<'mp3' | 'adts'>): Promise<IcyAdapter | undefined> {
  const { sampleFormat = 'Int16LE', sampleRate = 44100, bitrate = 128 , outputFormat = 'mp3' } = options ?? {};

  const audioType = audioFormatToAudioType(sampleFormat);

  if (!audioType) {
    return;
  }

  let stopped = false;
  let audioRequest!: RequestAudioStreamResult;
  let ffmpeg: FFmpegChildProcess;

  const outlet = new PassThrough();

  async function doSpawn() {
    if (stopped) {
      return;
    }

    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill();
    }

    ffmpeg = spawnFFmpeg([
      '-f', audioType!,
      '-vn',
      '-ar', sampleRate.toString(),
      '-ac', '2',
      '-i', '-',
      '-f', outputFormat,
      '-b:a', `${bitrate}k`,
      'pipe:1'
    ]);

    if (audioRequest?.id) {
      station.deleteAudioStream(audioRequest.id);
    }

    audioRequest = await station.requestAudioStream({
      sampleRate,
      format: sampleFormat
    });

    pipeline(audioRequest.stream, ffmpeg.stdin, doSpawn);
    ffmpeg.stdout.on('data', buffer => outlet.write(buffer));
  }

  await doSpawn();

  return {
    audioRequest,
    outlet,

    handler(req, res) {
      res.writeHead(200, {
        Connection: 'close'
        // TODO: Icy header
      });

      outlet.pipe(res);

      req.socket.on('close', () => {
        outlet.unpipe(res);
      });
    },

    stop() {
      stopped = true;

      station.deleteAudioStream(audioRequest.id);
      ffmpeg.kill();
      outlet.end();
    }
  }
}
