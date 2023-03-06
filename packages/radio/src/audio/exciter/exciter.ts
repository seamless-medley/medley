import { RequestAudioOptions, RequestAudioStreamResult, Station } from '@seamless-medley/core';
import { noop } from 'lodash';
import { pipeline, Readable } from 'stream';
import { ListenerSignature, TypedEmitter } from 'tiny-typed-emitter';
import { OpusPacketEncoder, OpusPacketEncoderOptions } from '../codecs/opus/stream';

export interface IExciter {
  get isPlayable(): boolean;
  prepare(): void;
  dispatch(): void;
}

/**
 * An Exciter read PCM stream from node-medley and encode it into Opus packets.
 */
export abstract class Exciter<Listeners extends ListenerSignature<Listeners> = {}> extends TypedEmitter<Listeners> implements IExciter {
  protected request?: RequestAudioStreamResult;
  protected stream?: Readable;
  protected opusEncoder: OpusPacketEncoder;

  constructor(
    protected station: Station,
    protected audioOptions: RequestAudioOptions,
    protected encoderOptions: Partial<OpusPacketEncoderOptions>
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

  abstract prepare(): void;
  abstract dispatch(): void;
}


