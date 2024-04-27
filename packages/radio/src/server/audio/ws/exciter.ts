import { Station } from "@seamless-medley/core";
import { mean } from "lodash";
import { encode } from 'notepack.io';
import { IExciter, Exciter } from "../../../audio/exciter";
import { AudioTransportExtraPayload } from "../../../audio/types";

interface WebSocketExciterEvents {
  packet(packet: Buffer): void;
  audioLatency(ms: number): void;
}

export class WebSocketExciter extends Exciter<WebSocketExciterEvents> implements IExciter {
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

  #audioLatency = 0;
  #lastAudioLatencyUpdated = 0;
  #preparedAudioLatencyInfo?: number;

  #latencyBuffer: number[] = [];

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

    if ((performance.now() - this.#lastAudioLatencyUpdated) > 1000) {
      const streamLatency = this.request?.getLatency() ?? 0;

      this.#latencyBuffer.push(streamLatency);
      if (this.#latencyBuffer.length >= 10) {
        this.#latencyBuffer.shift();
      }

      const audioLatency = Math.trunc(mean(this.#latencyBuffer));

      if (this.#audioLatency !== audioLatency) {
        this.#audioLatency = audioLatency;
        this.#lastAudioLatencyUpdated = performance.now();

        this.#preparedAudioLatencyInfo = audioLatency;
      }
    }
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

  get audioLatency() {
    return this.#audioLatency;
  }
}
