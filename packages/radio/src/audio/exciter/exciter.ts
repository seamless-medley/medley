import { KaraokeUpdateParams, RequestAudioOptions, RequestAudioStreamResult, Station } from '@seamless-medley/core';
import { isEqual, noop } from 'lodash';
import { pipeline, Readable } from 'node:stream';
import { ListenerSignature, TypedEmitter } from 'tiny-typed-emitter';
import { OpusPacketEncoder, OpusPacketEncoderOptions } from '../codecs/opus/stream';
import { AudioDispatcher, DispatcherPrivate } from './dispatcher';

export interface IExciter {
  readonly station: Station;
  readonly audioOptions: RequestAudioOptions;
  readonly encoderOptions: Partial<OpusPacketEncoderOptions>;

  /**
   * Start this exciter using the specified dispatcher to drive audio stream
   * @param dispatcher
   */
  start(dispatcher: AudioDispatcher): Promise<void>;

  stop(): void;

  get bitrate(): number;

  set bitrate(value: number);

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

/** @deprecated */
type ExciterRegistration = {
  readonly constructor: Function;
  readonly station: Station;
  readonly audioOptions: RequestAudioOptions;
  readonly encoderOptions: Partial<OpusPacketEncoderOptions>;
}

/** @deprecated */
const cache = new Map<ExciterRegistration, WeakRef<IExciter>>();

/** @deprecated */
const registry = new FinalizationRegistry<ExciterRegistration>((registration) => {
  if (!cache.get(registration)?.deref()) {
    cache.delete(registration)
  }
});

/** @deprecated */
function isSameRegistration(a: ExciterRegistration, b: ExciterRegistration) {
  return (a.constructor === b.constructor)
    && (a.station === b.station)
    && isEqual(a.audioOptions, b.audioOptions)
    && isEqual(a.encoderOptions, b.encoderOptions)
}

/** @deprecated */
function findRegistrationEntry(registration: ExciterRegistration) {
  return [...cache].find(([r]) => isSameRegistration(registration, r));
}

/** @deprecated */
function getExciterFromCache(registration: ExciterRegistration): IExciter | undefined {
  const entry = findRegistrationEntry(registration);

  if (entry) {
    const [key] = entry;
    const exciter = cache.get(key)?.deref();

    exciter?.incRef();
    return exciter;
  }
}

/** @deprecated */
function registerExciter<E extends IExciter>(exciter: E): E {
  const registration: ExciterRegistration = {
    constructor: exciter.constructor,
    station: exciter.station,
    audioOptions: exciter.audioOptions,
    encoderOptions: exciter.encoderOptions
  }

  exciter.incRef();

  registry.register(exciter, registration);
  cache.set(registration, new WeakRef(exciter));

  return exciter;
}

/** @deprecated */
function unregisterExciter(exciter: IExciter) {
  const entry = findRegistrationEntry({
    constructor: exciter.constructor,
    station: exciter.station,
    audioOptions: exciter.audioOptions,
    encoderOptions: exciter.encoderOptions
  });

  if (entry) {
    cache.delete(entry[0]);
  }

  return entry !== undefined;
}

/**
 * An Exciter read PCM stream from node-medley and encode it into Opus packets.
 */
export abstract class Exciter<Listeners extends ListenerSignature<Listeners> = {}> extends TypedEmitter<Listeners> implements ICarriableExciter {
  protected dispatcher?: AudioDispatcher;
  protected request?: RequestAudioStreamResult;
  protected outlet?: Readable;
  protected opusEncoder?: OpusPacketEncoder;

  protected readonly carriers: ICarrier[] = [];

  constructor(
    readonly station: Station,
    readonly audioOptions: RequestAudioOptions,
    readonly encoderOptions: Partial<OpusPacketEncoderOptions>
  ) {
    super();
  }

  async start(dispatcher: AudioDispatcher) {
    if (this.dispatcher) {
      throw new Error('An exciter could not be used multiple times');
    }

    return new Promise<void>(async (resolve, reject) => {
      this.dispatcher = dispatcher;
      try {
        this.request = await this.station.requestAudioStream(this.audioOptions);
        this.opusEncoder = new OpusPacketEncoder(this.encoderOptions);

        this.opusEncoder.on('ready', () => {
          this.outlet = pipeline(
            [
              this.request!.stream,
              this.opusEncoder!
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

  get bitrate() {
    return this.opusEncoder?.bitrate ?? this.encoderOptions.bitrate ?? 0;
  }

  set bitrate(value: number) {
    if (this.opusEncoder) {
      this.opusEncoder.bitrate = value;
    }
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

  protected read() {
    return this.outlet?.read() as (Buffer | undefined | null);
  }

  protected get playableCarriers() {
    return this.carriers.filter(c => c.isReady);
  }

  protected prepareAudioPacket(opus: Buffer): Buffer {
    return opus;
  }

  prepare(): void {
    const opus = this.read();

    if (!opus) {
      return;
    }

    const prepared = this.prepareAudioPacket(opus);

    for (const carrier of this.playableCarriers) {
			carrier.prepareAudioPacket(prepared);
		}
  }

  dispatch(): void {
    for (const carrier of this.playableCarriers) {
			carrier.dispatchAudio();
		}
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

  #ref = 0;

  incRef(): number {
    return ++this.#ref;
  }

  get refCount(): number {
    return this.#ref;
  }

  setKaraokeParams(params: KaraokeUpdateParams): boolean {
    if (!this.request) {
      return false;
    }

    return this.request.setFx('karaoke', params);
  }
}


