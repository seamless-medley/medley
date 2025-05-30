import { last } from 'lodash';
import type { types } from 'mediasoup';
import { $Exposing, $Kind, Exposable } from "../../../socket";
import { MixinEventEmitterOf } from '../../socket';
import type { ClientConsumerInfo, ClientTransportInfo, RTCTransponder as RemoteRTCTransponder } from '../../../remotes/rtc/transponder';
import type { RTCTransponder } from "../../audio/rtc/transponder";
import type { Station } from '../../../core';

export class ExposedTransponder extends MixinEventEmitterOf<RemoteRTCTransponder>() implements Exposable<RemoteRTCTransponder> {
  [$Exposing]: RTCTransponder;
  [$Kind] = 'transponder';

  constructor(transponder: RTCTransponder) {
    super();

    this[$Exposing] = transponder;

    this.#transponder.on('renew', this.#onRenew)
  }

  dispose() {
    this.#transponder.off('renew', this.#onRenew);
  }

  get #transponder() {
    return this[$Exposing];
  }

  #onRenew = () => {
    this.emit('renew');
  }

  get caps() {
    return this.#transponder.getCaps();
  }

  newClientTransport(sctpCaps: types.SctpCapabilities): Promise<ClientTransportInfo> {
    return this.#transponder.newClientTransport(sctpCaps, last(arguments));
  }

  closeClientTransport(transportId: string) {
    return this.#transponder.closeClientTransport(transportId);
  }

  initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id']): Promise<ClientConsumerInfo | undefined> {
    return this.#transponder.initiateClientConsumer(transportId, clientCaps, stationId);
  }

  startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters): Promise<void> {
    return this.#transponder.startClientConsumer(transportId, dtlsParameters);
  }

  stopClientConsumer(transportId: string): Promise<void> {
    return this.#transponder.stopClientConsumer(transportId);
  }
}
