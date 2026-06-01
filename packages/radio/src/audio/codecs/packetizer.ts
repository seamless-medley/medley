import { Transform, TransformCallback } from "node:stream";

export type PacketizerOptions = {
  numFrames: number;
  backlog?: number
}

export abstract class Packetizer extends Transform {
  protected numFrames: number;

  protected backlog: number;

  protected buffer = Buffer.alloc(0);

  constructor(options: PacketizerOptions) {
    super({ readableObjectMode: true });
    this.numFrames = options.numFrames;
    this.backlog = Math.max(0, options?.backlog ?? 0);
  }

  get blocksInBuffer() {
    return Math.trunc(this.buffer.length / this.blockSizeInBytes);
  }

  protected abstract get blockSizeInBytes(): number;

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.#process().then(() => done());
  }

  async #process() {
    const numBlocks = Math.max(this.blocksInBuffer - this.backlog, 0);

    let blocksProcessed = 0;
    const packets: Buffer[] = [];

    // process each block
    while (blocksProcessed < numBlocks) {
      const packet = await this.#packetize(blocksProcessed);

      if (packet === false) {
        break;
      }

      packets.push(packet);

      blocksProcessed++;
    }

    // remove process blocks
    if (blocksProcessed > 0) {
      this.buffer = this.buffer.subarray(blocksProcessed * this.blockSizeInBytes);
    }

    // emit results
    while (packets.length > 0) {
      this.push(packets.shift());
    }
  }

  async #packetize(index: number): Promise<Buffer | false> {
    const blockSizeInBytes = this.blockSizeInBytes;

    const start = index * blockSizeInBytes;
    const end = start + blockSizeInBytes;
    const block = this.buffer.subarray(start, end);

    if (block.byteLength !== blockSizeInBytes) {
      return false;
    }

    const packet = await this.processBlock(block);

    if (!packet) {
      return false;
    }

    return packet;
  }

  protected abstract processBlock(block: Buffer): Promise<Buffer | undefined>;
}

export class PCMPacketizer extends Packetizer {
  constructor(numFrames: number) {
    super({ numFrames });
  }

  protected get blockSizeInBytes(): number {
    return this.numFrames * 2 * 4;
  }

  override async processBlock(block: Buffer): Promise<Buffer | undefined> {
    return block;
  }
}

