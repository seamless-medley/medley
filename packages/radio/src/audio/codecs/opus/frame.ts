import { makeUint8ArrayFromText } from "@seamless-medley/utils";

const idHeaderdMarker = makeUint8ArrayFromText('OpusHead');
const commentHeaderdMarker = makeUint8ArrayFromText('OpusTags');

export type OpusHeadInfo = {
  channels: number;
  preSkip: number;
  sampleRate: number;
  outputGain: number;
  // channelMappingFamily: only support family 0 (RTP Family)
}

export class OpusHead {
  #info: OpusHeadInfo;

  constructor(info: Partial<OpusHeadInfo>) {
    this.#info = {
      channels: info.channels ?? 1,
      preSkip: info.preSkip ?? 0,
      sampleRate: info.sampleRate ?? 44100,
      outputGain: info.outputGain ?? 0
    }
  }

  toUint8Array(): Uint8Array {
    const { channels, preSkip, sampleRate, outputGain } = this.#info;

    const buffer = new Uint8Array(19); // channelMappingFamily 0 has fix length header
    const view = new DataView(buffer.buffer);

    buffer.set(idHeaderdMarker, 0); // 'OpusHead'
    view.setUint8(8, 1); // version
    view.setInt8(9, channels);
    view.setUint16(10, preSkip, true);
    view.setUint32(12, sampleRate, true);
    view.setUint16(16, outputGain, true);
    view.setUint8(18, 0); // RTP channel mapping family

    return buffer;
  }
}

export type OpusTagsInfo = {
  vendor: string;
}

export class OpusTags {
  #info: OpusTagsInfo;

  constructor(info: Partial<OpusTagsInfo>) {
    this.#info = {
      vendor: info.vendor ?? ''
    }
  }

  toUint8Array(): Uint8Array {
    const { vendor } = this.#info;
    const vendorBytes = new TextEncoder().encode(vendor);

    const size = 8 + 4 + vendorBytes.byteLength + 4 + 0;
    const buffer = new Uint8Array(size);
    const view = new DataView(buffer.buffer);

    buffer.set(commentHeaderdMarker, 0); // 'OpusTags'
    view.setUint32(8, vendorBytes.byteLength, true);
    buffer.set(vendorBytes, 12);
    return buffer;
  }
}
