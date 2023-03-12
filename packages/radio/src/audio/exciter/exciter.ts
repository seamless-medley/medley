import { RequestAudioOptions, RequestAudioStreamResult, Station } from '@seamless-medley/core';
import { noop } from 'lodash';
import { pipeline, Readable } from 'stream';
import { ListenerSignature, TypedEmitter } from 'tiny-typed-emitter';
import { OpusPacketEncoder, OpusPacketEncoderOptions } from '../codecs/opus/stream';

export interface IExciter {
  readonly station: Station;
  readonly audioOptions: RequestAudioOptions;
  readonly encoderOptions: Partial<OpusPacketEncoderOptions>;

  start(): Promise<void>;

  stop(): void;

  get bitrate(): number;

  set bitrate(value: number);

  setGain(gain: number): void;

  get isPlayable(): boolean;

  addCarrier(carrier: ICarrier): void;
  removeCarrier(carrier: ICarrier): void;

  prepare(): void;
  dispatch(): void;
}

export interface ICarrier {
  get isReady(): boolean;

  prepareAudioPacket(buffer: Buffer): Buffer | undefined;
  dispatchAudio(): boolean;
}
/**
 * An Exciter read PCM stream from node-medley and encode it into Opus packets.
 */
export abstract class Exciter<Listeners extends ListenerSignature<Listeners> = {}> extends TypedEmitter<Listeners> implements IExciter {
  protected request?: RequestAudioStreamResult;
  protected stream?: Readable;
  protected opusEncoder: OpusPacketEncoder;

  protected readonly carriers: ICarrier[] = [];

  constructor(
    readonly station: Station,
    readonly audioOptions: RequestAudioOptions,
    readonly encoderOptions: Partial<OpusPacketEncoderOptions>
  ) {
    super();

    this.opusEncoder = new OpusPacketEncoder(this.encoderOptions);
  }

  async start() {
    if (this.request) {
      return;
    }

    this.request = await this.station.requestAudioStream(this.audioOptions);

    this.stream = pipeline(
      [
        this.request.stream,
        this.opusEncoder
      ],
      noop
    ) as unknown as Readable;
  }

  stop() {
    if (!this.request) {
      return;
    }

    this.station.deleteAudioStream(this.request.id);
    this.request = undefined;
    //
    this.stream?.destroy();
    this.stream = undefined;
  }

  get bitrate() {
    return this.opusEncoder.bitrate;
  }

  set bitrate(value: number) {
    this.opusEncoder.bitrate = value;
  }

  setGain(gain: number) {
    if (!this.request) {
      return;
    }

    this.station.updateAudioStream(this.request.id, { gain });
  }

  get isPlayable(): boolean {
    return this.request?.stream.readable ?? false;
  }

  protected read() {
    return this.stream?.read() as (Buffer | undefined | null);
  }

  protected get playableCarriers() {
    return this.carriers.filter(c => c.isReady);
  }

  prepare(): void {
    const opus = this.read();

    if (!opus) {
      return;
    }

    for (const carrier of this.playableCarriers) {
			carrier.prepareAudioPacket(opus);
		}
  }

  dispatch(): void {
    for (const carrier of this.playableCarriers) {
			carrier.dispatchAudio();
		}
  }

  addCarrier(carrier: ICarrier) {
    if (this.carriers.includes(carrier)) {
      return;
    }

    this.carriers.push(carrier);
  }

  removeCarrier(carrier: ICarrier) {
    const index = this.carriers.indexOf(carrier);

    if (index > -1) {
      this.carriers.splice(index, 1);
    }
  }
}


