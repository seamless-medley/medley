import EventEmitter from 'eventemitter3';
import { decode } from "notepack.io";
import { stubFalse } from 'lodash';
import { Device as MediaSoupDevice, type types } from 'mediasoup-client';
import { AudioTransportEvents, type IAudioTransport } from "../../types";
import { type RTCTransponder } from '../../../../remotes/rtc/transponder';
import { type Remotable } from '../../../../socket/types';
import { type AudioTransportExtraPayload } from '../../../../audio/types';

export class WebRTCAudioTransport extends EventEmitter<AudioTransportEvents> implements IAudioTransport {
  readonly #transponder: Remotable<RTCTransponder>;

  readonly #ctx: AudioContext;

  readonly #device = new MediaSoupDevice();

  #transport?: types.Transport;

  #audioElement = new Audio();

  #sourceNode?: MediaStreamAudioSourceNode;

  #stationId?: string;

  constructor(transponder: Remotable<RTCTransponder>, context: AudioContext) {
    super();

    this.#transponder = transponder;
    this.#ctx = context;
    this.#device.load({ routerRtpCapabilities: transponder.caps() });
  }

  get ready(): boolean {
    return this.#device.loaded && this.#transport?.connectionState === 'connected';
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

    this.#transport.on('connect', (params, done, raise) => {
      this.#transponder
        .startClientConsumer(transportInfo.id, params.dtlsParameters)
        .then(done)
        .catch(raise);
    });

    return transport;
  }

  async play(stationId: string, options?: any) {
    this.#ctx.resume();

    // if (this.#stationId === stationId) {
    //   return true;
    // }

    if (this.#transport) {
      this.#transport.close();
      this.#transponder.closeClientTransport(this.#transport.id);
    }

    const transport = await this.#createTransport();

    if (!transport) {
      return false;
    }

    const consumerInfo = await this.#transponder.initiateClientConsumer(
      this.#transport!.id,
      this.#device.rtpCapabilities,
      stationId
    );

    if (!consumerInfo) {
      return false;
    }

    const consumer = await transport.consume(consumerInfo.rtp);

    const stream = new MediaStream();
    stream.addTrack(consumer.track);

    this.#sourceNode?.disconnect();
    this.#sourceNode = this.#ctx.createMediaStreamSource(stream);
    this.#sourceNode.connect(this.#ctx.destination);

    const state = await waitForTransportState(transport, ['connected', 'failed'], options?.timeout);

    if (state === undefined) {
      return false;
    }

    this.#audioElement.srcObject = stream;
    this.#audioElement.load();

    const result = await waitForAudioElement(this.#audioElement, options?.timeout);

    if (result) {
      this.#stationId = stationId;
    }

    if (consumerInfo.audioLevelData) {
      const dataConsumer = await transport.consumeData({
        ...consumerInfo.audioLevelData,
        sctpStreamParameters: consumerInfo.audioLevelData.sctpStreamParameters ?? {}
      });

      dataConsumer.on('message', (data: ArrayBuffer) => {
        const extra = decode(data) as AudioTransportExtraPayload;
        const [left_mag, left_peak, right_mag, right_peak, reduction] = extra;

        this.emit('audioExtra', {
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
