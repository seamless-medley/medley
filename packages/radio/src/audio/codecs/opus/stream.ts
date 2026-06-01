// This module works in Node env only


import { Packetizer, PacketizerOptions } from "../packetizer";
import { Opus, type OpusOptions } from "./loader";

export type OpusPacketEncoderOptions = OpusOptions & PacketizerOptions;

/**
 * Transform PCM stream into Raw Opus packets
 *
 */
export class OpusPacketEncoder extends Packetizer {
  #opus?: Opus;

  constructor(options?: Partial<OpusPacketEncoderOptions>) {
    super({
      numFrames: 960,
      ...options
    });

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

  get blockSizeInBytes() {
    return this.numFrames * 2 * 2; // frameSize * NUM_CHANNEL * SIZE_PER_SAMPLE
  }

  async processBlock(block: Buffer): Promise<Buffer | undefined> {
    return this.#opus?.encode(block, this.numFrames);
  }
}
