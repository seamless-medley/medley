import { Station } from "@seamless-medley/core";
import { encode } from 'notepack.io';
import { IExciter, Exciter } from "../../../audio/exciter";
import { AudioTransportExtraPayload } from "../../../audio/types";

interface AudioStreamPlayerEvents {
  packet(packet: Buffer): void;
}

export class WebSocketExciter extends Exciter<AudioStreamPlayerEvents> implements IExciter {
  constructor(station: Station, bitrate = 256_000) {
    super(
      station,
      {
        format: 'Int16LE',
        sampleRate: 48_000,
        bufferSize: 48_000 * 2.5,
        buffering: 12 * 960 // number of Opus packets x Opus packet size
      },
      { bitrate }
    );
  }

  #preparedPacket?: Buffer;

  override prepare(): void {
    const opus = this.read();

    if (!opus) {
      this.#preparedPacket = undefined;
      return;
    }

    const { audioLevels  } = this.station;

    const extra: AudioTransportExtraPayload = [
      audioLevels.left.magnitude,
      audioLevels.left.peak,
      audioLevels.right.magnitude,
      audioLevels.right.peak,
      audioLevels.reduction
    ]

    const infoBuffer = encode(extra) as Buffer;

    const resultPacket = Buffer.alloc(2 + infoBuffer.byteLength + opus.byteLength); // sizeof(info) + info + opus
    resultPacket.writeUInt16LE(infoBuffer.byteLength, 0);
    resultPacket.set(infoBuffer, 2);
    resultPacket.set(opus, 2 + infoBuffer.byteLength);

    this.#preparedPacket = resultPacket;
  }

  override dispatch(): void {
    if (this.#preparedPacket) {
      this.emit('packet', this.#preparedPacket);
    }

    this.#preparedPacket = undefined;
  }
}
