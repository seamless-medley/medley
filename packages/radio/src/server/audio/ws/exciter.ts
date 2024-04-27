import { Station } from "@seamless-medley/core";
import { encode } from 'notepack.io';
import { IExciter, Exciter } from "../../../audio/exciter";
import { AudioTransportExtraPayload } from "../../../audio/types";

interface WebSocketExciterEvents {
  packet(packet: Buffer): void;
  audioLatency(ms: number): void;
}

export class WebSocketExciter extends Exciter<WebSocketExciterEvents> implements IExciter {
  constructor(station: Station, bitrate = 256_000, backlog = 12) {
    super(
      station,
      {
        format: 'Int16LE',
        sampleRate: 48_000,
        bufferSize: 48_000 * 2.5,
        buffering: 960 * Math.max(1, backlog / 4)
      },
      { bitrate, backlog }
    );
  }

  #preparedPacket?: Buffer;

  #preparedAudioLatencyInfo?: number;

  override prepare(): void {
    const { opus } = this.read();

    if (!opus) {
      this.#preparedPacket = undefined;
      return;
    }

    const { audioLevels: { left, right, reduction }  } = this.station;

    const extra: AudioTransportExtraPayload = [
      left.magnitude,
      left.peak,
      right.magnitude,
      right.peak,
      reduction
    ];

    const infoBuffer = encode(extra) as Buffer;

    const resultPacket = Buffer.alloc(2 + infoBuffer.byteLength + opus.byteLength); // sizeof(info) + info + opus
    resultPacket.writeUInt16LE(infoBuffer.byteLength, 0);
    resultPacket.set(infoBuffer, 2);
    resultPacket.set(opus, 2 + infoBuffer.byteLength);

    this.#preparedPacket = resultPacket;

    this.updateAudioLatency((latency) => {
      this.#preparedAudioLatencyInfo = latency;
    });
  }

  override dispatch(): void {
    if (this.#preparedPacket) {
      this.emit('packet', this.#preparedPacket);
    }

    if (this.#preparedAudioLatencyInfo) {
      this.emit('audioLatency', this.#preparedAudioLatencyInfo);
    }

    this.#preparedPacket = undefined;
    this.#preparedAudioLatencyInfo = undefined;
  }
}
