import { pipeline, Readable, Transform, TransformCallback } from "stream";
import type { RequestAudioStreamResult } from "@seamless-medley/core";
import { createAudioResource, StreamType } from "@discordjs/voice";
import { Codec, CodecOptions } from "./codec";

export type ExciterOptions = Partial<CodecOptions> & {
  source: RequestAudioStreamResult;
}

class BufferredEncoder extends Transform {
  private buffer = Buffer.alloc(0);

  private codec: Codec;

  private packets: Buffer[] = [];

  constructor(options?: Partial<CodecOptions>) {
    super({ readableObjectMode: true });

    this.codec = Codec.create(options);
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const requiredBytes = 960 * 2 * 2; // bytes for 20ms
    const backlogSize = requiredBytes * 1;

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

    while (this.packets.length > 0) {
      this.push(this.packets.shift());
    }

    done();
  }
}

export const createExciter = ({ source, ...options }: ExciterOptions) => createAudioResource(
  pipeline([source.stream, new BufferredEncoder(options)], () => void undefined) as any as Readable,
  {
    inputType: StreamType.Opus,
    metadata: source
  }
);

// This uses prism-media directly
// export const createExciter = (source: RequestAudioStreamResult) => createAudioResource(
//   source.stream,
//   {
//     inputType: StreamType.Raw,
//     metadata: source
//   }
// );
