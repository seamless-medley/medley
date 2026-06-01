import dgram from 'node:dgram';
import { Router } from "express";
import { AudioFormat, RequestAudioOptions } from "@seamless-medley/medley";
import { StreamingAdapter } from "../types";
import { AudienceType, makeAudienceGroupId, Station } from "../../core";
import { AudioDispatcher, ICarrier, PCMExciter } from "../../audio/exciter";
import { createLogger, Logger } from '../../logging';

type Framing = {
  numFrames?: number;
  frameSize?: number;
  interval?: number;
  minBufferSize: number;
};

function calculateFraming(sampleRate: number, channels: number, sampleSize: number, bufferSize: number): Framing {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const g = gcd(sampleRate, 1000);
  const minFrames = sampleRate / g; // smallest frame count yielding a whole-ms interval
  const minInterval = 1000 / g; // e.g. 44100->441frames/10ms, 48000->48frames/1ms

  const bytesPerFrame = channels * sampleSize;
  const minBufferSize = minFrames * bytesPerFrame;

  if (bufferSize < minBufferSize) {
    return { minBufferSize };
  }

  const steps = Math.floor(bufferSize / minBufferSize);
  const numFrames = steps * minFrames;
  const interval = steps * minInterval;
  const frameSize = numFrames * bytesPerFrame;

  return { numFrames, frameSize, interval, minBufferSize };
}

const audienceGroup = makeAudienceGroupId(AudienceType.Streaming, 'udp');

export type UDPAdapterOptions = {
  sampleFormat: AudioFormat;
  sampleRate: number;
  address: string;
  port: number;
  frameSize: number;
  fx?: RequestAudioOptions['fx'];
}

export class UDPAdapter implements StreamingAdapter<undefined> {
  #logger: Logger;

  #framing: Framing;

  #dispatcher: AudioDispatcher;
  #carrier: Carrier;
  #exciter: PCMExciter;

  constructor(readonly station: Station, readonly options: UDPAdapterOptions) {
    this.#logger = createLogger({
      name: 'udp-streaming',
      id: this.#audience
    });

    const sampleSize = (() => {
      switch (options.sampleFormat) {
        case 'Int16LE':
        case 'Int16BE':
          return 2;

        case 'FloatLE':
        case 'FloatBE':
          return 2;
      }
    })();

    this.#framing = calculateFraming(options.sampleRate, 2, sampleSize, options.frameSize);

    if (this.#framing.numFrames === undefined) {
      this.#logger.error(`Frame size ${options.frameSize} is too small for the ${options.sampleRate} sample rate, at least ${this.#framing.minBufferSize} is required`);
    }

    this.#carrier = new Carrier(options.address, options.port);

    this.#exciter = new PCMExciter(station, {
      sampleRate: options.sampleRate,
      format: options.sampleFormat,
      fx: options.fx
    }, this.#framing.numFrames ?? 0);

    this.#exciter.addCarrier(this.#carrier);

    this.#dispatcher = new AudioDispatcher({ interval: this.#framing.interval ?? 0 });
  }

  get #audience() {
    const { address, port, sampleFormat } = this.options;
    return `${address}:${port}/${sampleFormat}`;
  }

  get error(): Error | undefined {
    return;
  }

  get initialized(): boolean {
    return true;
  }

  get statistics(): undefined {
    return;
  }

  get httpRouter(): Router | undefined {
    return;
  }

  async init(): Promise<void> {

  }

  start(): void {
    if (this.#framing.numFrames === undefined) {
      return;
    }

    this.#logger.debug('Start');

    this.station.addAudience(audienceGroup, this.#audience);
    this.#exciter.start(this.#dispatcher);
  }

  stop(): void {
    this.#logger.debug('Stop');

    this.station.removeAudience(audienceGroup, this.#audience);
    this.#exciter.stop();
  }

  destroy(): void {

  }
}

class Carrier implements ICarrier {
  #client = dgram.createSocket('udp4');

  #preparedPacket?: Buffer;

  constructor(private target: string, private port: number) {

  }

  get isReady(): boolean {
    return true;
  }

  prepareAudioPacket(packet: Buffer): Buffer | undefined {
    this.#preparedPacket = packet;
    return packet;
  }

  dispatchAudio(): boolean {
    if (!this.#preparedPacket) {
      return false;
    }

    this.#client.send(this.#preparedPacket, this.port, this.target);

    return true;
  }
}
