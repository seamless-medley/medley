import { Station } from "@seamless-medley/core";
import { encode } from 'notepack.io';
import { IExciter, Exciter } from "../../audio/exciter";
import { AudioTransportExtra } from "../../audio/types";

interface AudioStreamPlayerEvents {
  packet(packet: Buffer): void;
}

export class WebStreamExciter extends Exciter<AudioStreamPlayerEvents> implements IExciter {
  constructor(station: Station) {
    super(
      station,
      { format: 'Int16LE', sampleRate: 48_000 },
      { bitrate: 256_000 }
    );
  }

  private preparedPacket?: Buffer;

  prepare(): void {
    const opus = this.read();

    if (!opus) {
      this.preparedPacket = undefined;
      return;
    }

    const activeDeck = this.station.activeDeck;

    const position = activeDeck !== undefined ? this.station.getDeckPositions(activeDeck).current : 0;
    const { audioLevels: { left, right, reduction } } = this.station;

    const extras: AudioTransportExtra = [
      activeDeck,
      position,
      [left.magnitude, left.peak],
      [right.magnitude, right.peak],
      reduction
    ];

    const infoBuffer = encode(extras) as Buffer;

    const resultPacket = Buffer.alloc(2 + infoBuffer.byteLength + opus.byteLength); // sizeof(info) + info + opus
    resultPacket.writeUInt16LE(infoBuffer.byteLength, 0);
    resultPacket.set(infoBuffer, 2);
    resultPacket.set(opus, 2 + infoBuffer.byteLength);

    this.preparedPacket = resultPacket;
  }

  dispatch(): void {
    if (this.preparedPacket) {
      this.emit('packet', this.preparedPacket);
    }

    this.preparedPacket = undefined;
  }
}
