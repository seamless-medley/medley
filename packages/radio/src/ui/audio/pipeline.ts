import { EventEmitter } from "eventemitter3";
import worklet from "./worklet.js?worker&url";
import AudioClientWorker from './client-worker?worker';
import { RingBuffer } from "./ringbuffer";

import type { AudioTransportExtra } from "../../audio/types";
import type { MedleyStreamProcessorNodeOptions } from "./stream-processor";
import { AudioClientIntf } from "./client";

export type AudioPipelineEvents = {
  audioExtra(extra: AudioTransportExtra): void;
}

export class AudioPipeline extends EventEmitter<AudioPipelineEvents> {
  #ctx?: AudioContext;

  #node!: AudioWorkletNode;

  #pcmBuffer = new RingBuffer(960 * 25, 2);

  #clientWorker = new AudioClientWorker() as unknown as AudioClientIntf;

  constructor() {
    super();

    this.#clientWorker.postMessage({ type: 'init', pcmBuffer: this.#pcmBuffer });

    this.#clientWorker.onmessage = (e) => {
      if (e.data.type === 'open') {
        return;
      }
    }
  }

  play(stationId: string) {
    this.#pcmBuffer.reset();
    this.#clientWorker.postMessage({ type: 'play', stationId });
    this.#ctx?.resume();
  }

  // TODO: Call this when main client is connected
  async connect(socketId: string): Promise<void> {
    await this.#prepareAudioContext();
    this.#clientWorker.postMessage({ type: 'connect', socketId });
  }

  async #prepareAudioContext() {
    if (this.#ctx) {
      return;
    }

    try {
      this.#ctx = new AudioContext();
      await this.#ctx.audioWorklet.addModule(worklet);
    }
    catch (e) {
      console.log('Error adding AudioWorklet module', e);
      return;
    }

    const options: MedleyStreamProcessorNodeOptions = {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        pcmBuffer: this.#pcmBuffer,
      }
    }

    this.#node = new AudioWorkletNode(this.#ctx, 'medley-stream-processor', options);
    this.#node.onprocessorerror = this.#handleProcessorError;
    this.#node.port.onmessage = this.#handleWorkletNodeMessage;

    this.#node.connect(this.#ctx.destination);
  }

  #handleProcessorError = (e: Event) => {
    console.log('Processor error', e);
  }

  #handleWorkletNodeMessage = (e: MessageEvent<AudioTransportExtra>) => {
    this.emit('audioExtra', e.data);
  }
}
