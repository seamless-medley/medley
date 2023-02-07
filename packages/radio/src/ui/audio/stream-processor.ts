import { RingBuffer } from "./ringbuffer";
import type { AudioTransportExtra } from "../../audio/types";

export type ExtraTemporal = {
  remainingSamples: number;
  data: AudioTransportExtra;
}

export type MedleyStreamProcessorNodeOptions = Omit<AudioWorkletNodeOptions, 'processorOptions'> & {
  processorOptions: {
    minBufferSize?: number;
    pcmBuffer: RingBuffer;
  }
}

export class MedleyStreamProcessor extends AudioWorkletProcessor {
  #minBufferSize: number;
  #pcmBuffer: RingBuffer;
  #currentExtra?: AudioTransportExtra;

  constructor(options: MedleyStreamProcessorNodeOptions) {
    super();

    this.#minBufferSize = options.processorOptions.minBufferSize ?? 960;
    this.#pcmBuffer = options.processorOptions.pcmBuffer;

    Object.setPrototypeOf(this.#pcmBuffer, RingBuffer.prototype);
  }

  set #current(v: AudioTransportExtra) {
    if (this.#currentExtra !== v) {
      this.#currentExtra = v;
      this.port.postMessage(v);
    }
  }

  process(_: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const output = outputs[0];
    const samples = output[0].length;

    if (this.#pcmBuffer.getAvailableSamples() >= this.#minBufferSize) {
      const extra = this.#pcmBuffer.pull(output, samples);

      if (extra) {
        this.#current = extra;
      }
    }

    return true;
  }
}

