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

  #buffering = true;

  constructor(options?: Partial<OpusPacketEncoderOptions>) {
    super({ readableObjectMode: true });
    this.#frameSize = options?.frameSize ?? 960;
    this.#backlog = options?.backlog ?? 0;

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

  async #processBlock(index: number, requiredBytes: number, packets: Buffer[]): Promise<boolean> {
    const start = index * requiredBytes;
    const end = start + requiredBytes;
    const block = this.#buffer.subarray(start, end);

    if (block.byteLength !== requiredBytes) {
      return false;
    }

    const packet = await this.#opus?.encode(block, this.#frameSize);

    if (!packet) {
      return false;
    }

    packets.push(packet);
    return true;
  }

  async #process(requiredBytes: number) {
    const packets: Buffer[] = [];

    let blocksProcessed = 0;

    while (blocksProcessed * requiredBytes < this.#buffer.length) {
      const ok = await this.#processBlock(blocksProcessed, requiredBytes, packets);

      if (!ok) {
        break;
      }

      blocksProcessed++;
    }

    if (blocksProcessed > 0) {
      this.#buffer = this.#buffer.subarray(blocksProcessed * requiredBytes);
    }

    while (packets.length > 0) {
      this.push(packets.shift());
    }
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    const requiredBytes = this.#frameSize * 2 * 2; // bytes for 20ms (frame size * channel * sizeof(int16))

    if (this.#buffering) {
      if (this.#buffer.length < requiredBytes * this.#backlog) {
        done();
        return;
      }

      this.#buffering = false;
    }

    this.#process(requiredBytes).then(() => {
      if (!this.#buffering && this.#backlog) {
        if (this.#buffer.length <= 0) {
          this.#buffering = true;
        }
      }

      done();
    });
  }
}
