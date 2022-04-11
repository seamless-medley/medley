import { pipeline, Readable, Transform, TransformCallback } from "stream";
import type { RequestAudioStreamResult } from "@seamless-medley/core";
import { createAudioResource, StreamType } from "@discordjs/voice";
import { Codec } from "./codec";

class BufferredEncoder extends Transform {
  private buffer = Buffer.alloc(0);

  private codec = Codec.create();

  private packets: Buffer[] = [];

  constructor() {
    super({ readableObjectMode: true });
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const requiredBytes = 960 * 2 * 2; // bytes for 20ms
    const backlogSize = requiredBytes * 12;

    let blocksProcessed = 0;
    while (this.buffer.length >= backlogSize + requiredBytes * (blocksProcessed + 1)) {
      const start = blocksProcessed * requiredBytes;
      const end = start + requiredBytes;
      const block = this.buffer.slice(start, end);
      const packet = this.codec.encode(block, 960);
      //
      this.packets.push(packet);
      //
      blocksProcessed++;
    }

    if (blocksProcessed > 0) {
      this.buffer = this.buffer.slice(blocksProcessed * requiredBytes);
    }

    // Keep encoded packets in queue at least for 240ms
    while (this.packets.length > 12) {
      this.push(this.packets.shift());
    }

    done();
  }
}

export const createExciter = (source: RequestAudioStreamResult) => createAudioResource(
  pipeline([source.stream, new BufferredEncoder()], () => void undefined) as any as Readable,
  {
    inputType: StreamType.Opus,
    metadata: source
  }
);
