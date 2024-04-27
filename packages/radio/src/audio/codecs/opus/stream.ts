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
  #frameSize: number;

  #backlog: number;

  #buffer = Buffer.alloc(0);

  #opus?: Opus;

  constructor(options?: Partial<OpusPacketEncoderOptions>) {
    super({ readableObjectMode: true });
    this.#frameSize = options?.frameSize ?? 960;
    this.#backlog = Math.max(0, options?.backlog ?? 0);

    Opus.create(options).then((opus) => {
      this.#opus = opus;
      this.emit('ready');
    })
  }

  get bitrate() {
    return this.#opus?.bitrate ?? 0;
  }

  set bitrate(value: number) {
    if (this.#opus) {
      this.#opus.bitrate = value;
    }
  }

  get blocksInBuffer() {
    return Math.trunc(this.#buffer.length / this.#blockSizeInBytes);
  }

  get #blockSizeInBytes() {
    return this.#frameSize * 2 * 2; // frameSize * NUM_CHANNEL * SIZE_PER_SAMPLE
  }

  async #processBlock(index: number): Promise<Buffer | false> {
    const blockSizeInBytes = this.#blockSizeInBytes;

    const start = index * blockSizeInBytes;
    const end = start + blockSizeInBytes;
    const block = this.#buffer.subarray(start, end);

    if (block.byteLength !== blockSizeInBytes) {
      return false;
    }

    const packet = await this.#opus?.encode(block, this.#frameSize);

    if (!packet) {
      return false;
    }

    return packet;
  }

  async #process() {
    const numBlocks = Math.max(this.blocksInBuffer - this.#backlog, 0);

    let blocksProcessed = 0;
    const packets: Buffer[] = [];

    // process each block
    while (blocksProcessed < numBlocks) {
      const packet = await this.#processBlock(blocksProcessed);

      if (packet === false) {
        break;
      }

      packets.push(packet);

      blocksProcessed++;
    }

    // remove process blocks
    if (blocksProcessed > 0) {
      this.#buffer = this.#buffer.subarray(blocksProcessed * this.#blockSizeInBytes);
    }

    // emit results
    while (packets.length > 0) {
      this.push(packets.shift());
    }
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    this.#process().then(() => done());
  }
}
