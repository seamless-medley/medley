import EventEmitter from 'eventemitter3';
import { decode } from "notepack.io";
import { stubFalse } from 'lodash';
import { Device as MediaSoupDevice, type types } from 'mediasoup-client';
import type { AudioTransportEvents, AudioTransportPlayResult, AudioTransportState, IAudioTransport } from "../../transport";
import { type RTCTransponder } from '../../../../remotes/rtc/transponder';
import { type Remotable } from '../../../../socket';
import type { AudioTransportExtra, AudioTransportExtraPayload } from '../../../../audio/types';

export type PlayOptions = {
  timeout?: number;
}

export class WebRTCAudioTransport extends EventEmitter<AudioTransportEvents> implements IAudioTransport {
  readonly #transponder: Remotable<RTCTransponder>;

  readonly #ctx: AudioContext;

  readonly #device: MediaSoupDevice;

  #transport?: types.Transport;

  #audioElement = new Audio();

  #sourceNode?: MediaStreamAudioSourceNode;

  #outputNode: AudioNode;

  #stationId?: string;

  #state: AudioTransportState = 'new';

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

    const consumerInfo = await this.#transponder.initiateClientConsumer(
      this.#transport!.id,
      this.#device.rtpCapabilities,
      stationId
    );

    if (!consumerInfo) {
      return 'transport_failed';
    }

    const consumer = await this.#transport.consume(consumerInfo.rtp);

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

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
      const dataConsumer = await this.#transport.consumeData({
        ...consumerInfo.audioLevelData,
        sctpStreamParameters: consumerInfo.audioLevelData.sctpStreamParameters ?? {}
      });

      dataConsumer.on('message', (data: ArrayBuffer) => {
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
      });
    }

    return result;
  }

  #delayedAudioExtra: AudioTransportExtra[] = [];

  #pushAudioExtra(extra: AudioTransportExtra) {
    this.#delayedAudioExtra.push(extra);

    while (this.#delayedAudioExtra.length > Math.ceil(this.#ctx.outputLatency * this.#ctx.sampleRate / 960) + 12) {
      this.emit('audioExtra', this.#delayedAudioExtra.shift()!);
    }
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
