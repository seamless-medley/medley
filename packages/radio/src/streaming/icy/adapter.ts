import { RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { RequestHandler } from "express";
import { noop } from "lodash";
import { PassThrough, pipeline } from "stream";
import { createFFmpegOverseer } from "../ffmpeg";
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


  }


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
      overseer.kill();
      outlet.end();
    }
  }
}
