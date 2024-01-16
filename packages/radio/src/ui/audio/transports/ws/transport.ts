import { EventEmitter } from "eventemitter3";
import worklet from "./worklets/stream-consumer-module.js?worker&url";
import AudioClientWorker from './client?worker';
import type { AudioClientIntf, OpenMessage } from "./client";
import { RingBuffer } from "./ringbuffer";
import type { AudioTransportExtra } from "../../../../audio/types";
import type { MedleyStreamProcessorNodeOptions } from "./worklets/stream-consumer";
import type { AudioTransportEvents, AudioTransportState, IAudioTransport } from "../../transport";

/**
 * This is where the whole audio pipeline happens
 */
export class WebSocketAudioTransport extends EventEmitter<AudioTransportEvents> implements IAudioTransport {
  /**
   * Web Audio API context, needed for sending audio data to the output device
   */
  readonly #ctx: AudioContext;

  /**
   * Web Audio API Worklet node which attach a stream-processor used for reading decoded PCM data and feed it into Web Audio API context
   */
  #consumerNode!: AudioWorkletNode;

  #outputNode: AudioNode;

  /**
   * A RingBuffer for holding 500ms of stereo PCM data
   */
  #pcmBuffer = new RingBuffer(960 * 25, 2);

  /**
   * For audio socket connection and Opus decoding
   */
  #clientWorker = new AudioClientWorker() as unknown as AudioClientIntf;

  #prepared = false;

  #state: AudioTransportState = 'new';

  constructor(socketId: string, context: AudioContext, output: AudioNode) {
    super();

    this.#ctx = context;
    this.#outputNode = output;

    this.#clientWorker.postMessage({ type: 'init', pcmBuffer: this.#pcmBuffer });

    const listener = (e: MessageEvent<OpenMessage>) => {
      if (e.data.type === 'open') {
        this.#clientWorker.removeEventListener('message', listener);
        this.#setState('ready');
        this.#pcmBuffer.reset();
        return;
      }
    }

    this.#clientWorker.addEventListener('message', listener);
    this.#clientWorker.postMessage({ type: 'connect', socketId });
  }

  get state() {
    return this.#state;
  }

  #setState(newState: AudioTransportState) {
    if (this.#state === newState) {
      return;
    }

    this.#state = newState;
    this.emit('stateChanged', newState);
  }

  async play(stationId: string) {
    if (!this.#prepared) {
      return false;
    }

    this.#clientWorker.postMessage({ type: 'play', stationId });
    this.#ctx?.resume();
    return true;
  }

  async prepareAudioContext() {
    if (this.#prepared) {
      return;
    }

    try {
      await this.#ctx.audioWorklet.addModule(worklet);
    }
    catch (e) {
      console.error('Error adding AudioWorklet module', e);
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

    this.#consumerNode.connect(this.#outputNode);

    this.#prepared = true;
  }

  #handleProcessorError = (e: Event) => {
    console.error('Processor error', e);
  }

  #delayedAudioExtra: AudioTransportExtra[] = [];

  #handleWorkletNodeMessage = ({ data: extra }: MessageEvent<AudioTransportExtra>) => {
    this.#delayedAudioExtra.push(extra);

    while (this.#delayedAudioExtra.length > Math.ceil(this.#ctx.outputLatency * this.#ctx.sampleRate / 960) + 32 + 12) {
      this.emit('audioExtra', this.#delayedAudioExtra.shift()!);
    }
  }
}
