import { inherits } from 'util';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { AudioFormat, RequestAudioCallbackOptions, RequestAudioOptions, RequestAudioResult, RequestAudioStreamResult } from './index.d';

const medley = require('node-gyp-build')(process.env.MEDLEY_DEMO ? process.cwd() : __dirname);

inherits(medley.Medley, EventEmitter);

export const Medley = medley.Medley;
export const Queue = medley.Queue;

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

  const buffers: Buffer[] = [];

  const bytesPerSample = formatToBytesPerSample(options.format);
  const totalSamples = () => buffers.reduce((a, b) => a + b.length, 0) / bytesPerSample / 2;

  const consume = async (size: number) => {
    return await this['*$reqAudio$consume'](streamId, Math.max(size, (options.buffering ?? 0) * bytesPerSample * 2)) as Buffer;
  }

  const { sampleRate = 44100 } = options;

  const stream = new Readable({
    highWaterMark: sampleRate * bytesPerSample * 2,
    objectMode: false,
    read: async (size: number) => {
      buffers.push(await consume(size));
      stream.push(buffers.pop());
    }
  });

  if (options.preFill) {
    const consumingSize = (options.buffering || sampleRate * 0.01) * bytesPerSample * 2;
    while (totalSamples() < options.preFill) {
      buffers.push(await consume(consumingSize));
    }
  }

  stream.on('close', async () => {
    stream.emit('closed');
  });

  stream.on('finish', async () => {
    stream.emit('finished');
  });

  const streamResult: RequestAudioStreamResult = {
    stream,
    ...result
  }

  audioStreamResults.set(streamId, streamResult);

  return streamResult;
}

Medley.prototype.deleteAudioStream = function(id: number) {
  const result = audioStreamResults.get(id);
  if (!result) {
    return;
  }

  this['*$reqAudio$dispose'](id);

  result.stream.destroy();
  audioStreamResults.delete(id);
}

Medley.prototype.requestAudioCallback = function(options: RequestAudioCallbackOptions): RequestAudioResult {
  const result = this['*$reqAudio'](options) as RequestAudioResult;
  const streamId = result.id;
  const bytesPerSample = formatToBytesPerSample(options.format);

  const doConsume = async () => {
    const consumingSize = (options.buffering || (options.sampleRate || 44100) * 0.01) * bytesPerSample * 2;
    const buffer = await this['*$reqAudio$consume'](streamId, consumingSize) as Buffer;
    await options.callback(buffer);
    doConsume();
  }

  doConsume();

  return result;
}