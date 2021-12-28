import { inherits } from 'util';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { RequestAudioStreamOptions, RequestAudioStreamResult } from './index.d';

const medley = require('node-gyp-build')(process.env.MEDLEY_DEMO ? process.cwd() : __dirname);

inherits(medley.Medley, EventEmitter);

export const Medley = medley.Medley;
export const Queue = medley.Queue;

Medley.prototype.requestAudioStream = function(options: RequestAudioStreamOptions = { format: 'FloatLE' }): RequestAudioStreamResult {
  const result = this['*$rac'](options) as Omit<RequestAudioStreamResult, 'stream'>;
  const streamId = result.id;

  const stream = new Readable({
    highWaterMark: 16384,
    objectMode: false,

    read: async (size: number) => {
      const buffer = await this['*$rac$consume'](streamId, size) as Buffer;
      stream.push(buffer);
    }
  });

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
