import { EventEmitter } from "eventemitter3";
import worklet from "./worklets/stream-consumer-module.js?worker&url";
import AudioClientWorker from './client?worker';
import type { AudioClientIntf, OpenMessage, OutputMessage } from "./client";
import { AudioTransportExtraPayloadWithTimestamp, RingBufferWithExtra } from "./ringbuffer";
import type { AudioTransportExtra, AudioTransportExtraPayload } from "../../../../audio/types";
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
  #pcmBuffer = new RingBufferWithExtra(960 * 25, 2);

  /**
   * For audio socket connection and Opus decoding
   */
  #clientWorker = new AudioClientWorker() as unknown as AudioClientIntf;

  #prepared = false;

  #state: AudioTransportState = 'new';

  #transmissionLatency = 0;

  static #hasWorklet = false;

  constructor(socketId: string, context: AudioContext, output: AudioNode) {
    super();

    this.#ctx = context;
    this.#outputNode = output;

    this.#clientWorker.postMessage({ type: 'init', pcmBuffer: this.#pcmBuffer });

    const listener = (e: MessageEvent<OutputMessage>) => {
      if (e.data.type === 'open') {
        this.#clientWorker.removeEventListener('message', listener);
        this.#setState('ready');
        this.#pcmBuffer.reset();
        return;
      }
    }

    this.#clientWorker.addEventListener('message', listener);
    this.#clientWorker.addEventListener('message', this.#audioLatencyListener);
    this.#clientWorker.postMessage({ type: 'connect', socketId });
  }

  #audioLatencyListener = (e: MessageEvent<OutputMessage>) => {
    if (e.data.type === 'audio-latency') {
      this.#audioLatency = e.data.latencyMs / 1000;
      return;
    }
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

  set transmissionLatency(seconds: number) {
    this.#transmissionLatency = seconds;
  }

  async play(stationId: string) {
    if (!this.#prepared) {
      return false;
    }

    this.#clientWorker.postMessage({ type: 'play', stationId });
    this.#ctx?.resume();
    return true;
  }

  async stop() {
    this.#clientWorker.postMessage({ type: 'stop' });

    return new Promise<void>((resolve) => {
      const listener = (e: MessageEvent<OutputMessage>) => {
        if (e.data.type === 'stopped') {
          resolve();
          this.#clientWorker.removeEventListener('message', listener);
        }
      }

      this.#clientWorker.addEventListener('message', listener);

      this.emit('audioExtra', {
        audioLevels: {
          left: {
            magnitude: 0,
            peak: 0
          },
          right: {
            magnitude: 0,
            peak: 0
          },
          reduction: 0
        }
      });

      this.#delayedAudioExtra = [];
    });
  }

  async prepareAudioContext() {
    if (this.#prepared) {
      return;
    }

    if (!WebSocketAudioTransport.#hasWorklet) try {
      await this.#ctx.audioWorklet.addModule(worklet);
      WebSocketAudioTransport.#hasWorklet = true;
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

  async dispose() {
    this.#consumerNode?.disconnect();
    await this.stop();
  }

  #handleProcessorError = (e: Event) => {
    console.error('Processor error', e);
  }

  #audioLatency = 0;


  #pipelineLatency = 0;

  #delayedAudioExtra: AudioTransportExtra[] = [];

  #handleWorkletNodeMessage = ({ data: payload }: MessageEvent<AudioTransportExtraPayloadWithTimestamp>) => {
    const {
      extra: [left_mag, left_peak, right_mag, right_peak, reduction],
      timestamp
    } = payload;


    const now = Math.trunc(performance.timeOrigin + performance.now());
    this.#pipelineLatency = (now - timestamp) / 1000;

    this.#pushAudioExtra({
      audioLevels: {
        left: {
          magnitude: left_mag,
          peak: left_peak,
        },
        right: {
          magnitude: right_mag,
          peak: right_peak
        },
        reduction
      }
    });
  }

  get latency() {
    return 0.3 + this.#audioLatency + this.#transmissionLatency + this.#pipelineLatency + this.#ctx.outputLatency + this.#ctx.baseLatency;
  }

  #pushAudioExtra(extra: AudioTransportExtra) {
    this.#delayedAudioExtra.push(extra);

    const minBlock = Math.ceil(this.latency / 0.02);
    const blockCount = this.#delayedAudioExtra.length - minBlock;

    if (blockCount > 0) {
      const blocks = this.#delayedAudioExtra.splice(0, blockCount);
      this.emit('audioExtra', blocks.at(-1)!);
    }
  }
}
