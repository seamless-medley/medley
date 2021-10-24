////// <reference path="./index.d.ts" />

import { inherits } from 'util';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

const medley = require('bindings')({ module_root: process.cwd(), bindings: 'medley' });

inherits(medley.Medley, EventEmitter);

export const Medley = medley.Medley;
export const Queue = medley.Queue;

Medley.prototype.requestAudioStream = function(format: string = 'FloatLE') {
  const streamId: number = this['*$rac'](format);

  console.log('streamId', streamId);

  const stream = new Readable({
    highWaterMark: 16384,
    objectMode: false,

    read: async (size: number) => {
      // console.log('Reading', size);
      const result = await this['*$rac$consume'](streamId, size);
      // console.log('result', result);
      void size;
      stream.push(result);
    }
  });

  stream.on('close', async () => {
    stream.emit('closed');
  });

  stream.on('finish', async () => {
    stream.emit('finished');
  });

  return stream;
}