import { AudioTransportExtraPayloadWithTimestamp, RingBufferWithExtra } from "../ringbuffer";

export type MedleyStreamProcessorNodeOptions = Omit<AudioWorkletNodeOptions, 'processorOptions'> & {
  processorOptions: {
    minBufferSize: number;
    pcmBuffer: RingBufferWithExtra;
  }
}

/**
 * A simple AudioWorkletProcessor to be attached with a Web Audio API's AudioWorkletNode instance
 *
 * It simply reads PCM data out of a shared memory produced by the audio client worker
 */
export class MedleyStreamConsumer extends AudioWorkletProcessor {
  #minBufferSize: number;
  #pcmBuffer: RingBufferWithExtra;
  #currentExtra?: AudioTransportExtraPayloadWithTimestamp;

  constructor(options: MedleyStreamProcessorNodeOptions) {
    super();

    this.#minBufferSize = options.processorOptions.minBufferSize;
    this.#pcmBuffer = options.processorOptions.pcmBuffer;

    Object.setPrototypeOf(this.#pcmBuffer, RingBufferWithExtra.prototype);
  }

  set #current(v: AudioTransportExtraPayloadWithTimestamp) {
    if (this.#currentExtra !== v) {
      this.#currentExtra = v;
      this.port.postMessage(v);
    }
  }

  process(_: Float32Array[][], [output]: Float32Array[][], parameters: Partial<Record<string, Float32Array>>) {
    const samples = output[0].length;

    if (this.#pcmBuffer.getAvailableSamples() >= Math.max(samples, this.#minBufferSize)) {
      const extra = this.#pcmBuffer.pull(output, samples);

      if (extra) {
        this.#current = extra;
      }
    }

    return true;
  }
}

