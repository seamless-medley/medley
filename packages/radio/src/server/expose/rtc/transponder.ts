import { last } from 'lodash';
import type { types } from 'mediasoup';
import { MixinEventEmitterOf } from '../../socket';
import type { ClientConsumerInfo, ClientTransportInfo, RTCTransponder as RemoteRTCTransponder, Exposable, Notify } from '@seamless-medley/remote';
import type { RTCTransponder, RTCWorker } from "../../audio/rtc/transponder";
import type { Station } from '../../../core';

export class ExposedTransponder extends MixinEventEmitterOf<RemoteRTCTransponder>() implements Exposable<RemoteRTCTransponder> {
  $Exposing: RTCTransponder;
  $Kind = 'transponder';
  notify!: Notify<RemoteRTCTransponder>;

  constructor(transponder: RTCTransponder) {
    super();

    this.$Exposing = transponder;

    this.#transponder.on('restart', this.#onRestart);
  }

  dispose() {
    this.#transponder.off('restart', this.#onRestart);
  }

  get #transponder() {
    return this.$Exposing;
  }

  #onRestart = (worker: RTCWorker) => {
    this.emit('renew', worker.id);
  }

  get rtcCaps() {
    return this.#transponder.getCaps();
  }

  newClientTransport(rtcId: string, sctpCaps: types.SctpCapabilities): Promise<ClientTransportInfo> {
    return this.#transponder.newClientTransport(rtcId, sctpCaps, last(arguments));
  }

  closeClientTransport(transportId: string) {
    return this.#transponder.closeClientTransport(transportId, last(arguments));
  }

  initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id']): Promise<ClientConsumerInfo | undefined> {
    return this.#transponder.initiateClientConsumer(transportId, clientCaps, stationId, last(arguments));
  }

  startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters): Promise<void> {
    return this.#transponder.startClientConsumer(transportId, dtlsParameters, last(arguments));
  }

  stopClientConsumer(transportId: string): Promise<void> {
    return this.#transponder.stopClientConsumer(transportId, last(arguments));
  }
}
