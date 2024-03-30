import { EventEmitter } from 'node:events';
import { basename, dirname } from 'node:path';
import { Readable } from 'node:stream';
import type { AudioFormat, RequestAudioOptions, RequestAudioResult, RequestAudioStreamResult } from './index.d';

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

  const bytesPerSample = formatToBytesPerSample(options.format);

  const consume = async (size: number) => {
    return await this['*$reqAudio$consume'](streamId, Math.max(size, (options.buffering ?? 0) * bytesPerSample * 2)) as Buffer;
  }

  const { sampleRate = 44100 } = options;

  const stream = new Readable({
    highWaterMark: sampleRate * bytesPerSample * 2,
    objectMode: false,
    read: async (size: number) => {
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
    update: options => this.updateAudioStream(streamId, options),
    getLatency: () => this['*$reqAudio$getLatency'](streamId),
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
