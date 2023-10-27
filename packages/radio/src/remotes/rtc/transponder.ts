import type { types } from 'mediasoup';
import type { ClientConsumerInfo, ClientTransportInfo } from '../../server/audio/rtc/transponder';
import type { Station } from '@seamless-medley/core';

export interface RTCTransponder {
  readonly caps: types.RtpCapabilities;

  newClientTransport(sctpCaps: types.SctpCapabilities): Promise<ClientTransportInfo>;

  closeClientTransport(transportId: string): Promise<void>;

  initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id']): Promise<ClientConsumerInfo | undefined>;

  startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters): Promise<void>;
}
