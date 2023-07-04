import { EventEmitter } from "eventemitter3";
import worklet from "./worklets/stream-consumer-module.js?worker&url";
import AudioClientWorker from './client?worker';
import type { AudioClientIntf } from "./client";
import { RingBuffer } from "./ringbuffer";
import type { AudioTransportExtra } from "../../audio/types";
import type { MedleyStreamProcessorNodeOptions } from "./worklets/stream-consumer";

export type AudioPipelineEvents = {
  audioExtra(extra: AudioTransportExtra): void;
}

/**
 * This is where the whole audio pipeline happens
 */
export class AudioPipeline extends EventEmitter<AudioPipelineEvents> {
  /**
   * Web Audio API context, needed for sending audio data to the output device
   */
  #ctx?: AudioContext;

  /**
   * Web Audio API Worklet node which attach a stream-processor used for reading decoded PCM data and feed it into Web Audio API context
   */
  #consumerNode!: AudioWorkletNode;

  /**
   * A RingBuffer for holding 500ms of stereo PCM data
   */
  #pcmBuffer = new RingBuffer(960 * 25, 2);

  /**
   * For audio socket connection and Opus decoding
   */
  #clientWorker = new AudioClientWorker() as unknown as AudioClientIntf;

  constructor() {
    super();

    this.#clientWorker.postMessage({ type: 'init', pcmBuffer: this.#pcmBuffer });

    this.#clientWorker.onmessage = (e) => {
      if (e.data.type === 'open') {
        this.#pcmBuffer.reset();
        return;
      }
    }
  }

  play(stationId: string) {
    this.#clientWorker.postMessage({ type: 'play', stationId });
    this.#ctx?.resume();
  }

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
        minBufferSize: 960,
        pcmBuffer: this.#pcmBuffer,
      }
    }

    this.#consumerNode = new AudioWorkletNode(this.#ctx, 'medley-stream-consumer', options);
    this.#consumerNode.onprocessorerror = this.#handleProcessorError;
    this.#consumerNode.port.onmessage = this.#handleWorkletNodeMessage;

    this.#consumerNode.connect(this.#ctx.destination);
  }

  #handleProcessorError = (e: Event) => {
    console.log('Processor error', e);
  }

  #delayedAudioExtra: AudioTransportExtra[] = [];

  #handleWorkletNodeMessage = ({ data: extra }: MessageEvent<AudioTransportExtra>) => {
    this.#delayedAudioExtra.push(extra);

    while (this.#delayedAudioExtra.length > Math.ceil(this.#ctx!.outputLatency * this.#ctx!.sampleRate / 960) + 1) {
      this.emit('audioExtra', this.#delayedAudioExtra.shift()!);
    }
  }
}
