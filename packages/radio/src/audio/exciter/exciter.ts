import { mean, noop } from 'lodash';
import { pipeline, Readable } from 'node:stream';
import type { KaraokeUpdateParams, RequestAudioOptions, RequestAudioStreamResult } from '@seamless-medley/medley';
import { ListenerSignature, TypedEmitter } from 'tiny-typed-emitter';
import { Station } from '../../core';
import { OpusPacketEncoder, OpusPacketEncoderOptions } from '../codecs/opus/stream';
import { AudioDispatcher, DispatcherPrivate } from './dispatcher';
import { PCMPacketizer } from '../codecs/packetizer';

export interface IExciter {
  readonly station: Station;
  readonly audioOptions: RequestAudioOptions;

  /**
   * Start this exciter using the specified dispatcher to drive audio stream
   * @param dispatcher
   */
  start(dispatcher: AudioDispatcher): Promise<void>;

  stop(): void;

  setGain(gain: number): void;

  get isPlayable(): boolean;

  incRef(): number;

  get refCount(): number;

  prepare(): void;
  dispatch(): void;
}

export interface ICarriableExciter extends IExciter {
  addCarrier(carrier: ICarrier): number;
  removeCarrier(carrier: ICarrier): number;
  hasCarrier(): boolean;
}

export interface ICarrier {
  get isReady(): boolean;

  prepareAudioPacket(buffer: Buffer): Buffer | undefined;
  dispatchAudio(): boolean;
}

/**
 * Exciter reads PCM stream from node-medley packetize the PCM stream into stream of packets
 */
export abstract class Exciter<Listeners extends ListenerSignature<Listeners> = {}> extends TypedEmitter<Listeners> implements ICarriableExciter {
  protected dispatcher?: AudioDispatcher;
  protected request?: RequestAudioStreamResult;

  // This must be assigned on start, the stream must be operating in object mode
  protected outlet?: Readable;

  #ref = 0;

  protected readonly carriers: ICarrier[] = [];

  constructor(
    readonly station: Station,
    readonly audioOptions: RequestAudioOptions
  ) {
    super();
  }

  abstract start(dispatcher: AudioDispatcher): Promise<void>;

  stop() {
    (this.dispatcher as unknown as DispatcherPrivate)?.remove(this);

    if (!this.request) {
      return;
    }

    this.station.deleteAudioStream(this.request.id);
    this.request = undefined;

    this.outlet?.destroy;
    this.outlet = undefined;
  }

  get started() {
    return this.outlet !== undefined;
  }

  setGain(gain: number) {
    if (!this.request) {
      return;
    }

    this.station.updateAudioStream(this.request.id, { gain });
  }

  get isPlayable(): boolean {
    return this.request?.stream?.readable ?? false;
  }

  protected get playableCarriers() {
    return this.carriers.filter(c => c.isReady);
  }

  protected prepareAudioPacket(packet: Buffer): Buffer {
    return packet;
  }

  protected read(): Buffer | undefined {
    return this.outlet?.read();
  }

  prepare(): void {
    const packet = this.read();

    if (!packet) {
      return;
    }

    const prepared = this.prepareAudioPacket(packet);

    for (const carrier of this.playableCarriers) {
			carrier.prepareAudioPacket(prepared);
		}
  }

  dispatch(): void {
    for (const carrier of this.playableCarriers) {
			carrier.dispatchAudio();
		}
  }

  incRef(): number {
    return ++this.#ref;
  }

  get refCount(): number {
    return this.#ref;
  }

  addCarrier(carrier: ICarrier) {
    if (this.carriers.includes(carrier)) {
      return this.carriers.length;
    }

    return this.carriers.push(carrier);
  }

  removeCarrier(carrier: ICarrier) {
    const index = this.carriers.indexOf(carrier);

    if (index > -1) {
      this.carriers.splice(index, 1);
    }

    return this.carriers.length;
  }

  hasCarrier() {
    return this.carriers.length > 0;
  }

  setKaraokeParams(params: KaraokeUpdateParams): boolean {
    if (!this.request) {
      return false;
    }

    return this.request.setFx('karaoke', params);
  }
}

export class PCMExciter<Listeners extends ListenerSignature<Listeners> = {}> extends Exciter<Listeners> {
  #packetizer: PCMPacketizer;

  constructor(
    station: Station,
    audioOptions: RequestAudioOptions,
    numFrames: number
  ) {
    super(station, audioOptions);
    this.#packetizer = new PCMPacketizer(numFrames);
  }

  async start(dispatcher: AudioDispatcher) {
    if (this.dispatcher === dispatcher) {
      return;
    }

    if (this.dispatcher) {
      throw new Error('An exciter could not be used multiple times');
    }

    this.dispatcher = dispatcher;
    this.request = await this.station.requestAudioStream(this.audioOptions);

    this.outlet = pipeline(
      [
        this.request!.stream as unknown as NodeJS.ReadableStream,
        this.#packetizer! as unknown as NodeJS.WritableStream,
      ],
      noop
    ) as unknown as Readable;

    (dispatcher as unknown as DispatcherPrivate).add(this);
  }
}


/**
 * OpusExciter reads PCM stream from node-medley and encode it into Opus packets.
 */
export class OpusExciter<Listeners extends ListenerSignature<Listeners> = {}> extends Exciter<Listeners> {
  protected opusEncoder?: OpusPacketEncoder;

  constructor(
    station: Station,
    audioOptions: RequestAudioOptions,
    readonly encoderOptions: Partial<OpusPacketEncoderOptions>
  ) {
    super(station, audioOptions);
  }

  async start(dispatcher: AudioDispatcher) {
    if (this.dispatcher === dispatcher) {
      return;
    }

    if (this.dispatcher) {
      throw new Error('An exciter could not be used multiple times');
    }

    return new Promise<void>(async (resolve, reject) => {
      this.dispatcher = dispatcher;
      try {
        this.opusEncoder = new OpusPacketEncoder(this.encoderOptions);

        this.opusEncoder.once('ready', async () => {
          this.request = await this.station.requestAudioStream(this.audioOptions);

          this.outlet = pipeline(
            [
              this.request!.stream as unknown as NodeJS.ReadableStream,
              this.opusEncoder! as unknown as NodeJS.WritableStream,
            ],
            noop
          ) as unknown as Readable;

          (dispatcher as unknown as DispatcherPrivate).add(this);
          resolve();
        });
      }
      catch (e: unknown) {
        this.dispatcher = undefined;
        reject(e);
      }
    });
  }

  get bitrate() {
    return this.opusEncoder?.bitrate ?? this.encoderOptions.bitrate ?? 0;
  }

  set bitrate(value: number) {
    if (this.opusEncoder) {
      this.opusEncoder.bitrate = value;
    }
  }

  #calculateLatency() {
    const blocksInEncoder = this.opusEncoder?.blocksInBuffer ?? 0;
    const packetsInOutlet = (this.outlet?.readableLength ?? 0)
    const encoderLatency = (blocksInEncoder + packetsInOutlet) * 960 / 48_000 * 1000;
    const streamLatency = this.request?.getLatency() ?? 0;
    return streamLatency + encoderLatency;
  }

  #audioLatencyMs = 0;
  #lastAudioLatencyUpdated = 0;
  #latencyBuffer: number[] = [];

  protected updateAudioLatency(cb: (latencyMs: number) => any) {
    if ((performance.now() - this.#lastAudioLatencyUpdated > 1000)) {
      this.#latencyBuffer.push(this.#calculateLatency());
      if (this.#latencyBuffer.length >= 30) {
        this.#latencyBuffer.shift();
      }

      // Reduce resolution by a decade
      const audioLatency = Math.trunc(mean(this.#latencyBuffer) / 10) * 10;

      if (this.#audioLatencyMs !== audioLatency) {
        this.#audioLatencyMs = audioLatency;
        this.#lastAudioLatencyUpdated = performance.now();

        cb(audioLatency);
      }
    }
  }

  /**
   * Latency in milliseconds
   */
  get audioLatencyMs() {
    return this.#audioLatencyMs;
  }
}


