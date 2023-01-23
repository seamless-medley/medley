import { makeUint8ArrayFromText } from "@seamless-medley/utils";
import { sum } from "lodash";
import { compute as computeChecksum } from "./checksum";

export type OggPageInfo = {
  type: {
    continued?: boolean;
    first?: boolean;
    last?: boolean;
  }
  granulePosition: bigint;
  serial: number;
  sequence: number;
  data?: Uint8Array;
}

function lacing(n: number): number[] {
  if (n <= 0) {
    return [];
  }

  const result: number[] = [];

  while (n >= 255) {
    result.push(255);
    n -= 255;
  }

  result.push(n);

  return result;
}

export const pageMarker = makeUint8ArrayFromText('OggS');

export class OggPage {
  #info: OggPageInfo;

  constructor(info: Partial<OggPageInfo>) {
    this.#info = {
      type: info.type ?? {},
      granulePosition: info.granulePosition ?? -1n,
      serial: info.serial ?? 0,
      sequence: info.sequence ?? 0,
      data: info.data
    }
  }

  toUint8Array(): Uint8Array {
    const { type, granulePosition, serial, sequence, data } = this.#info;

    const dataSize = data?.byteLength ?? 0;
    const lacingValues = lacing(dataSize);

    const size = sum([
      4, // capture
      1, // version
      1, // type
      8, // granule position
      4, // serual
      4, // sequence
      4, // checksum
      1, // number of segments
      lacingValues.length * 1,
      dataSize
    ]);

    const buffer = new Uint8Array(size);
    const view = new DataView(buffer.buffer);

    buffer.set(pageMarker, 0); // 'OggS'
    view.setUint8(4, 0); // version
    view.setUint8(5, ( // type
      (type.continued ? 1 : 0) << 0 |
      (type.first ? 1 : 0) << 1 |
      (type.last ? 1 : 0) << 2
    ));
    view.setBigInt64(6, granulePosition, true);
    view.setUint32(14, serial, true);
    view.setUint32(18, sequence, true);
    view.setUint32(22, 0, true); // Initial checksum
    view.setUint8(26, lacingValues.length);

    for (const [i, segmentSize] of lacingValues.entries()) {
      view.setUint8(27 + i, segmentSize);
    }

    if (data) {
      let dataOffset = 0;
      let viewOffset = 27 + lacingValues.length;
      for (const segmentSize of lacingValues) {
        if (!segmentSize) {
          break;
        }

        const segment = data.subarray(dataOffset, dataOffset + segmentSize);
        buffer.set(segment, viewOffset);

        dataOffset += segmentSize;
        viewOffset += segmentSize;
      }
    }

    view.setUint32(22, computeChecksum(buffer), true);
    return buffer;
  }
}
