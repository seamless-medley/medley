import EventEmitter from 'eventemitter3';
import { decode } from "notepack.io";
import { stubFalse } from 'lodash';
import { Device as MediaSoupDevice, type types } from 'mediasoup-client';
import type { AudioTransportEvents, AudioTransportPlayResult, AudioTransportState, IAudioTransport } from "../../transport";
import type { RTCTransponder, Remotable, AudioTransportExtra, AudioTransportExtraPayload } from '@seamless-medley/remote';

type AudioLatencyEvent = {
  type: 'audio-latency';
  latencyMs: number;
}

type TransportEvent = AudioLatencyEvent;

export type PlayOptions = {
  timeout?: number;
}

/**
 * This transport uses Mediasoup for its WebRTC functionalities,
 * and is the first transport to be used at client-side where possible.
 *
 * Proper network setup must be done to make sure this transport is available to the client.
 *
 * Fallback to WebSocketAudioTransport if the WebRTC negotiation failed
 */
export class WebRTCAudioTransport extends EventEmitter<AudioTransportEvents> implements IAudioTransport {
  readonly #transponder: Remotable<RTCTransponder>;

  readonly #ctx: AudioContext;

  readonly #device: MediaSoupDevice;

  #transport?: types.Transport;

  #consumer?: types.Consumer;

  #audioLevelConsumer?: types.DataConsumer;

  #eventConsumer?: types.DataConsumer;

  #audioElement = new Audio();

  #sourceNode?: MediaStreamAudioSourceNode;

  #outputNode: AudioNode;

  #stationId?: string;

  #state: AudioTransportState = 'new';

  #transmissionLatency = 0;

  #audioLatency = 0;

  constructor(transponder: Remotable<RTCTransponder>, device: MediaSoupDevice, context: AudioContext, output: AudioNode) {
    super();

    this.#transponder = transponder;
    this.#device = device;
    this.#ctx = context;
    this.#outputNode = output;

    this.#transponder.on('renew', this.#handleTransponderRenewal);

    this.#createTransport();
  }

  get state() {
    return this.#state;
  }

  set transmissionLatency(seconds: number) {
    this.#transmissionLatency = seconds;
  }

  #handleTransponderRenewal = async () => {
    if (this.#state !== 'ready') {
      return;
    }

    this.#transport?.close();
    await this.#createTransport();

    const stationId = this.#stationId;
    this.#stationId = undefined;

    if (stationId) {
      this.play(stationId);
    }
  }

  #setState(newState: AudioTransportState) {
    if (this.#state === newState) {
      return;
    }

    if (newState === 'failed') {
      this.#transport?.close();
    }

    this.#state = newState;
    this.emit('stateChanged', newState);
  }

  async #createTransport() {
    const transportInfo = await this.#transponder.newClientTransport(this.#device.sctpCapabilities).catch(stubFalse);
    if (!transportInfo) {
      return;
    }

    const transport = this.#transport = this.#device.createRecvTransport({
      id: transportInfo.id,
      iceCandidates: transportInfo.ice.candidates,
      iceParameters: transportInfo.ice.params,
      dtlsParameters: transportInfo.dtls,
      sctpParameters: transportInfo.sctp
    });

    let nullConsumer: Promise<types.DataConsumer>;

    this.#transport.on('connect', (params, done, raise) => {
      this.#transponder
        .startClientConsumer(transportInfo.id, params.dtlsParameters)
        .then(done)
        .catch(raise);

      nullConsumer?.then(c => c.close());
    });

    nullConsumer = this.#transport.consumeData({
      ...transportInfo.tester,
      sctpStreamParameters: transportInfo.tester.sctpStreamParameters ?? {}
    });

    if (!transport) {
      this.#setState('failed');
      return;
    }

    const rtcState = await waitForTransportState(transport, ['connected', 'failed'], 1000);
    this.#setState(rtcState === 'connected' ? 'ready' : 'failed');
  }

  async prepareAudioContext() {

  }

  async play(stationId: string, options?: PlayOptions): Promise<AudioTransportPlayResult> {
    this.#ctx.resume();

    if (this.#stationId === stationId) {
      return true;
    }

    if (!this.#transport) {
      return 'transport_failed';
    }

    this.#transponder.stopClientConsumer(this.#transport.id);

    const consumerInfo = await this.#transponder.initiateClientConsumer(
      this.#transport.id,
      this.#device.rtpCapabilities,
      stationId
    );

    if (!consumerInfo) {
      return 'transport_failed';
    }

    this.#consumer?.close();
    this.#consumer = await this.#transport.consume(consumerInfo.rtp);

    const stream = new MediaStream();
    stream.addTrack(this.#consumer.track);

    this.#sourceNode?.disconnect();
    this.#sourceNode = this.#ctx.createMediaStreamSource(stream);
    this.#sourceNode.connect(this.#outputNode);

    const state = await waitForTransportState(this.#transport, ['connected', 'failed'], options?.timeout);

    if (state === undefined) {
      return 'transport_failed';
    }

    this.#audioElement.srcObject = stream;
    this.#audioElement.load();

    const result = await waitForAudioElement(this.#audioElement, options?.timeout);

    if (!result) {
      return 'media_failed';
    }

    this.#stationId = stationId;

    if (consumerInfo.audioLevelData) {
      this.#audioLevelConsumer?.off('message', this.#audioExtraHandler);
      this.#audioLevelConsumer?.close();

      this.#audioLevelConsumer = await this.#transport.consumeData({
        ...consumerInfo.audioLevelData,
        sctpStreamParameters: consumerInfo.audioLevelData.sctpStreamParameters ?? {}
      });

      this.#audioLevelConsumer.on('message', this.#audioExtraHandler);
    }

    if (consumerInfo.eventData) {
      this.#eventConsumer?.off('message', this.#eventConsumerMessageHandler);
      this.#eventConsumer?.close();

      this.#eventConsumer = await this.#transport.consumeData({
        ...consumerInfo.eventData,
        sctpStreamParameters: consumerInfo.eventData.sctpStreamParameters ?? {}
      });

      this.#eventConsumer.on('message', this.#eventConsumerMessageHandler);
    }

    this.#audioLatency = (consumerInfo.audioLatencyMs || 0) / 1000;

    return result;
  }

  #eventConsumerMessageHandler = (data: ArrayBuffer) => {
    const event = decode(data) as TransportEvent;

    switch (event.type) {
      case 'audio-latency':
        this.#audioLatency = event.latencyMs / 1000;
        break;
    }
  }

  #audioExtraHandler = (data: ArrayBuffer) => {
    const extra = decode(data) as AudioTransportExtraPayload;
    const [left_mag, left_peak, right_mag, right_peak, reduction] = extra;

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

  /**
   * Total audio latency in seconds
   */
  get latency() {
    return this.#audioLatency + this.#transmissionLatency + this.#ctx.outputLatency + this.#ctx.baseLatency;
  }

  #delayedAudioExtra: AudioTransportExtra[] = [];

  #pushAudioExtra(extra: AudioTransportExtra) {
    this.#delayedAudioExtra.push(extra);

    const minBlock = Math.ceil(this.latency / 0.02);
    const blockCount = this.#delayedAudioExtra.length - minBlock;

    if (blockCount > 0) {
      const blocks = this.#delayedAudioExtra.splice(0, blockCount);
      this.emit('audioExtra', blocks.at(-1)!);
    }
  }

  async stop() {
    this.#eventConsumer?.off('message', this.#eventConsumerMessageHandler);
    this.#eventConsumer?.close();
    this.#eventConsumer = undefined;

    this.#audioLevelConsumer?.off('message', this.#audioExtraHandler);
    this.#audioLevelConsumer?.close();
    this.#audioLevelConsumer = undefined;

    this.#consumer?.close();
    this.#consumer = undefined;

    this.#sourceNode?.disconnect();
    this.#sourceNode = undefined;

    this.#stationId = undefined;

    if (this.#transport) {
      await this.#transponder.stopClientConsumer(this.#transport.id);
    }

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
  }

  async dispose() {
    await this.stop();
  }
}

async function waitForTransportState(transport: types.Transport, states: types.ConnectionState[], timeout = 2000): Promise<types.ConnectionState | undefined> {
  if (states.includes(transport.connectionState)) {
    return transport.connectionState;
  }

  return new Promise((resolve) => {
    const abortTimer = setTimeout(() => resolve(undefined), timeout);

    const handler = (state: types.ConnectionState) => {
      if (states.includes(state)) {
        clearTimeout(abortTimer);

        transport.off('connectionstatechange', handler);
        resolve(state);
      }
    };

    transport.on('connectionstatechange', handler);
  });
}

async function waitForAudioElement(element: HTMLAudioElement, timeout = 2000) {
  return new Promise<boolean>((resolve) => {
    const abortTimer = setTimeout(() => resolve(false), timeout);

    const handler = (e: Event) => {
      clearTimeout(abortTimer);

      element.removeEventListener('canplay', handler);
      resolve(true);
    }

    element.addEventListener('canplay', handler);
  });
}
