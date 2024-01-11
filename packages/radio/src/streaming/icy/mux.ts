import { omit, toPairs } from "lodash";
import { Transform, TransformCallback } from "stream";

const EMPTY_METADATA = Buffer.from([0]);
const META_BLOCK_SIZE = 16;
const MAX_LENGTH = META_BLOCK_SIZE * 255;

export type IcyMetadata = {
  'StreamTitle': string;
  [key: string]: string;
}

export class MetadataMux extends Transform {

  private bytesLeft: number;

  constructor(private interval: number = 0) {
    super();

    this.bytesLeft = this.interval;
  }

  private tail = Buffer.alloc(0);

  metadata?: IcyMetadata | string;

  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback) {
    if (this.interval <= 0) {
      done(null, chunk);
      return;
    }

    let chunkLength = chunk.length;

    for (;;) {
      const buffers: Buffer[] = [];
      if (this.tail.length > 0) buffers.push(this.tail);
      if (chunkLength > 0) buffers.push(chunk);

      const data = Buffer.concat(buffers);
      const size = Math.min(data.length, this.bytesLeft);

      const head = size < data.length ? data.subarray(0, size) : data;
      this.tail = data.subarray(size);

      this.bytesLeft -= size;
      this.push(head);

      if (this.bytesLeft === 0) {
        this.push(this.fetchMetadataBuffer());
        this.bytesLeft = this.interval;
      }

      if (this.tail.length === 0) {
        break;
      }

      chunkLength = 0;
    }

    done();
  }

  private fetchMetadataBuffer() {
    if (!this.metadata) {
      return EMPTY_METADATA;
    }

    const metadata = (typeof this.metadata === 'string') ? ({ StreamTitle: this.metadata }) : this.metadata;

    const kv = [['StreamTitle', metadata.StreamTitle]].concat(toPairs(omit<IcyMetadata, 'StreamTitle'>(metadata, 'StreamTitle')));

    const all = kv.reduce<{ e: string[], l: number}>((a, [k, v]) => {
      const line = `${k}='${v}';`;
      const len = Buffer.byteLength(line);

      if (a.l + len <= MAX_LENGTH) {
        a.e.push(line);
        a.l += len;
      }
      return a;
    }, { e: [], l: 0 }).e.join('');

    const dataSize = Buffer.byteLength(all);
    const numBlocks = Math.ceil(dataSize / META_BLOCK_SIZE);
    const bufferSize = numBlocks * META_BLOCK_SIZE + 1;

    const buffer = Buffer.alloc(bufferSize);

    buffer[0] = numBlocks;
    const bytesWritten = buffer.write(all, 1) + 1;
    buffer.fill(0, bytesWritten, buffer.length);

    this.metadata = undefined;

    return buffer;
  }
}
