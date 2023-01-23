// This module works in Node env only

import { Transform, TransformCallback } from "node:stream";
import { Opus, type OpusOptions } from "./loader";

export type OpusPacketEncoderOptions = OpusOptions & {
  frameSize?: number;
  backlog?: number
}

/**
 * Transform PCM stream into Raw Opus Packet
 *
 */
export class OpusPacketEncoder extends Transform {
  private frameSize: number;

  private backlog: number;

  private buffer = Buffer.alloc(0);

  private opus: Opus;

  private packets: Buffer[] = [];

  constructor(options?: Partial<OpusPacketEncoderOptions>) {
    super({ readableObjectMode: true });
    this.frameSize = options?.frameSize ?? 960;
    this.backlog = options?.backlog ?? 1;
    this.opus = Opus.create(options);
  }

  get bitrate() {
    return this.opus.bitrate;
  }

  set bitrate(value: number) {
    this.opus.bitrate = value;
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const requiredBytes = this.frameSize * 2 * 2; // bytes for 20ms (frame size * channel * sizeof(int16))
    const backlogSize = requiredBytes * this.backlog;

    let blocksProcessed = 0;
    while (this.buffer.length >= backlogSize + requiredBytes * (blocksProcessed + 1)) {
      const start = blocksProcessed * requiredBytes;
      const end = start + requiredBytes;
      const block = this.buffer.slice(start, end);
      const packet = this.opus.encode(block, this.frameSize);
      //
      this.packets.push(packet);
      //
      blocksProcessed++;
    }

    if (blocksProcessed > 0) {
      this.buffer = this.buffer.slice(blocksProcessed * requiredBytes);
    }

    while (this.packets.length > 0) {
      this.push(this.packets.shift());
    }

    done();
  }
}
