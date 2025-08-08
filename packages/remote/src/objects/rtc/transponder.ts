import type { types } from 'mediasoup';
import type { Station } from "@seamless-medley/radio";

type ConsumerResponse = Pick<types.Consumer, 'id' | 'producerId' | 'kind' | 'rtpParameters'>;
type DataConsumerResponse = Pick<types.DataConsumer, 'id' | 'dataProducerId' | 'label' | 'sctpStreamParameters'>;

export type ClientConsumerInfo = {
  rtp: ConsumerResponse;
  audioLevelData?: DataConsumerResponse;
  eventData?: DataConsumerResponse;
  audioLatencyMs: number;
}

export type ClientTransportInfo = {
  id: types.Transport['id'];
  ice: {
    params: types.WebRtcTransport['iceParameters'];
    candidates: types.WebRtcTransport['iceCandidates'];
  },
  dtls: types.WebRtcTransport['dtlsParameters'];
  sctp: types.WebRtcTransport['sctpParameters'];
  tester: DataConsumerResponse;
}

export interface RTCTransponder {
  readonly caps: types.RtpCapabilities;

  newClientTransport(sctpCaps: types.SctpCapabilities): Promise<ClientTransportInfo>;

  closeClientTransport(transportId: string): Promise<void>;

  initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id']): Promise<ClientConsumerInfo | undefined>;

  startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters): Promise<void>;

  stopClientConsumer(transportId: string): Promise<void>;

  ϟrenew(): void;
}
