import { RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { TypedEmitter } from 'tiny-typed-emitter';
import { noop } from "lodash";
import { encode } from 'notepack.io';
import { pipeline, Readable } from "stream";
import { OpusPacketEncoder } from "../../audio/codecs/opus/stream";
import { type IPlayer } from "./dispatcher";
import { AudioTransportExtra } from "../../audio/types";

interface AudioStreamPlayerEvents {
  packet(packet: Buffer): void;
}

export class AudioStreamPlayer extends TypedEmitter<AudioStreamPlayerEvents> implements IPlayer {
  #request?: RequestAudioStreamResult;
  #stream?: Readable;

  constructor(private station: Station) {
    super();
  }

  async start() {
    if (this.#request) {
      return;
    }

    this.#request = await this.station.requestAudioStream({
      format: 'Int16LE',
      sampleRate: 48_000
    });

    this.#stream = pipeline(
      [
        this.#request.stream,
        new OpusPacketEncoder({ bitrate: 256_000 })
      ],
      noop
    ) as unknown as Readable;
  }

  stop() {
    if (!this.#request) {
      return;
    }

    this.station.deleteAudioStream(this.#request.id);
    this.#request = undefined;
    //
    this.#stream?.destroy();
    this.#stream = undefined;
  }

  isPlayable(): boolean {
    return this.#request?.stream.readable ?? false;
  }

  private preparedPacket?: Buffer;

  prepare(): void {
    const opus = this.#stream?.read() as (Buffer | undefined | null);
    if (!opus) {
      this.preparedPacket = undefined;
      return;
    }

    const activeDeck = this.station.activeDeck;

    const position = activeDeck !== undefined ? this.station.getDeckPositions(activeDeck).current : 0;
    const { audioLevels: { left, right, reduction } } = this.station;

    const values: AudioTransportExtra = [
      activeDeck,
      position,
      [left.magnitude, left.peak],
      [right.magnitude, right.peak],
      reduction
    ];

    const infoBuffer = encode(values) as Buffer;

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
