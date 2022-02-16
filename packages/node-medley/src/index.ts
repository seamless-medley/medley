import { inherits } from 'util';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { RequestAudioCallbackOptions, RequestAudioOptions, RequestAudioResult, RequestAudioStreamResult } from './index.d';

const medley = require('node-gyp-build')(process.env.MEDLEY_DEMO ? process.cwd() : __dirname);

inherits(medley.Medley, EventEmitter);

export const Medley = medley.Medley;
export const Queue = medley.Queue;

Medley.prototype.requestAudioStream = async function(options: RequestAudioOptions = { format: 'FloatLE' }): Promise<RequestAudioStreamResult> {
  const result = this['*$reqAudio'](options) as RequestAudioResult;
  const streamId = result.id;

  const buffers: Buffer[] = [];

  const totalSamples = () => buffers.reduce((a, b) => a + b.length, 0) / 4 / 2;

  const consume = async (size: number) => {
    return await this['*$reqAudio$consume'](streamId, options.buffering || size) as Buffer;
  }

  const stream = new Readable({
    highWaterMark: 16384,
    objectMode: false,
    read: async (size: number) => {
      buffers.push(await consume(size));
      stream.push(buffers.pop());
    }
  });

  if (options.preFill) {
    const consumingSize = (options.buffering || (options.sampleRate || 44100) * 0.01) * 4 * 2;
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

  return {
    stream,
    ...result
  };
}

Medley.prototype.requestAudioCallback = function(options: RequestAudioCallbackOptions): RequestAudioResult {
  const result = this['*$reqAudio'](options) as RequestAudioResult;
  const streamId = result.id;

  const doConsume = async () => {
    const buffer = await this['*$reqAudio$consume'](streamId, options.buffering || (result.sampleRate * 0.01)) as Buffer;
    await options.callback(buffer);
    doConsume();
  }

  doConsume();

  return result;
}