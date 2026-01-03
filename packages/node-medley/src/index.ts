import { EventEmitter } from 'node:events';
import { basename, dirname } from 'node:path';
import { Readable } from 'node:stream';
import type { AudioFormat, MedleyOptions, Medley as MedleyType, Queue as QueueType, RequestAudioOptions, RequestAudioResult, RequestAudioStreamResult, TrackInfo } from './index.d';

const nodeGypBuild = require('node-gyp-build');
const module_id = process.env.MEDLEY_DEV ? dirname(__dirname) : __dirname;

const medley = nodeGypBuild(module_id);

export const Medley = medley.Medley;
export const Queue = medley.Queue;

Object.setPrototypeOf(Medley.prototype, EventEmitter.prototype);

Medley.getInfo = function() {
  const { runtime = {}, ...rest } = Medley.$getInfo();

  return {
    runtime: {
      ...nodeGypBuild.parseTags(basename(nodeGypBuild.resolve(module_id))),
      ...runtime,
    },
    ...rest
  }
};

export const audioFormats = ['Int16LE', 'Int16BE', 'FloatLE', 'FloatBE'] as const;

const formatToBytesPerSample = (format: AudioFormat) => {
  switch (format) {
    case 'FloatBE':
    case 'FloatLE':
      return 4;

    case 'Int16BE':
    case 'Int16LE':
      return 2;

    default:
      return 0;
  }
}

const audioStreamResults = new Map<number, RequestAudioStreamResult>();

Medley.prototype.requestAudioStream = async function(options: RequestAudioOptions = { format: 'FloatLE' }): Promise<RequestAudioStreamResult> {
  const result = this['*$reqAudio'](options) as RequestAudioResult;
  const streamId = result.id;

  const sampleRate = Number(options.sampleRate ?? 44100);
  const defaultBuffering = sampleRate * 0.01;
  const defaultBufferSize = sampleRate * 0.25;
  let buffering = Number(options.buffering ?? defaultBuffering);
  const bufferSize = Number(options.bufferSize ?? defaultBufferSize);

  if (buffering < 1) {
    throw new Error('buffering cannot be less than 1');
  }

  if (bufferSize <= buffering) {
    throw new Error('bufferSize is too small');
  }

  const bytesPerSample = formatToBytesPerSample(options.format);

  const getSamplesReady = () => (this['*$reqAudio$getSamplesReady'](streamId) ?? 0);

  const waitForBuffer = (sampleSize: number) => new Promise<void>((resolve) => {
    const check = () => {
      if (getSamplesReady() >= sampleSize) {
        resolve();
        return;
      }

      setTimeout(check, 10);
    }

    check();
  });

  const consume = async (size: number) => {
    return await this['*$reqAudio$consume'](streamId, Math.max(size, buffering * bytesPerSample * 2)) as Buffer;
  }

  const stream = new Readable({
    // 50% higher than the bufferSize
    highWaterMark: bufferSize * 1.5 * bytesPerSample * 2,
    objectMode: false,
    read: async (size: number) => {
      await waitForBuffer(buffering);
      stream.push(await consume(size));
    }
  });

  stream.on('close', async () => {
    stream.emit('closed');
  });

  stream.on('finish', async () => {
    stream.emit('finished');
  });

  const streamResult: RequestAudioStreamResult = {
    stream,
    ...result,
    update: (newOptions) => {
      if (newOptions.buffering) {
        const newBuffering = Number(newOptions.buffering ?? defaultBuffering);

        if (newBuffering < 1) {
          throw new Error('buffering cannot be less than 1');
        }

        if (bufferSize <= newBuffering) {
          throw new Error('bufferSize is too small');
        }

        buffering = newBuffering;
      }

      return this.updateAudioStream(streamId, newOptions)
    },
    getLatency: () => {
      const r = buffering + (stream.readableLength / bytesPerSample / 2);
      const bufferDelay = (r / sampleRate * 1000);
      return bufferDelay + this['*$reqAudio$getLatency'](streamId);

    },
    getFx: type => this['*$reqAudio$getFx'](streamId, type) as never,
    setFx: (type, params) => this['*$reqAudio$setFx'](streamId, type, params)
  }

  audioStreamResults.set(streamId, streamResult);

  return streamResult;
}

Medley.prototype.deleteAudioStream = function(id: number) {
  const request = audioStreamResults.get(id);
  if (!request) {
    return;
  }

  const result = this['*$reqAudio$dispose'](id);

  request.stream.destroy();
  audioStreamResults.delete(id);

  return result;
}

export function createMedley<T extends TrackInfo = TrackInfo>(options?: MedleyOptions) {
  const queue = new Queue() as QueueType<T>;
  const medley = new Medley(queue, options) as MedleyType<T>;
  return { medley, queue }
}
