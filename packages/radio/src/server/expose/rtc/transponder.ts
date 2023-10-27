import { type types } from 'mediasoup';
import { $Exposing, Exposable } from "../../../socket/expose";
import { MixinEventEmitterOf } from "../../../socket/types";
import { type RTCTransponder as RemoteRTCTransponder } from '../../../remotes/rtc/transponder';
import type { ClientTransportInfo, RTCTransponder, ClientConsumerInfo } from "../../audio/rtc/transponder";
import { type Station } from '@seamless-medley/core';
import { last } from 'lodash';

export class ExposedTransponder extends MixinEventEmitterOf<RemoteRTCTransponder>() implements Exposable<RemoteRTCTransponder> {
  [$Exposing]: RTCTransponder;

  constructor(transponder: RTCTransponder) {
    super();

    this[$Exposing] = transponder;
  }

  get #transponder() {
    return this[$Exposing];
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
}
