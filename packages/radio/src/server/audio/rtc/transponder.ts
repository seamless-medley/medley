import { AudienceType, makeAudienceGroupId, type Station } from '@seamless-medley/core';
import { type types, createWorker } from 'mediasoup';
import { Socket } from 'socket.io';
import { RTCExciter } from './exciter';
import { AudioDispatcher } from '../../../audio/exciter';
import { type WebRtcConfig } from '../../../config/webrtc';

export type ClientTransportInfo = {
  id: types.Transport['id'];
  ice: {
    params: types.WebRtcTransport['iceParameters'];
    candidates: types.WebRtcTransport['iceCandidates'];
  },
  dtls: types.WebRtcTransport['dtlsParameters'];
  sctp: types.WebRtcTransport['sctpParameters'];
}

export type ClientTransportData = {
  socket: Socket<{}>;
  disconnectHandler: () => void;
  stationId?: string;
}

export type ClientConsumerInfo = {
  rtp: Pick<types.Consumer, 'id' | 'producerId' | 'kind' | 'rtpParameters'>;
  audioLevelData?: Pick<types.DataConsumer, 'id' | 'dataProducerId' | 'label' | 'sctpStreamParameters'>;
}

export class RTCTransponder {
  #dispatcher = new AudioDispatcher();

  #worker!: types.Worker;
  #webrtcServer!: types.WebRtcServer;
  #router!: types.Router;

  #published = new Map<Station, RTCExciter>();

  #transport = new Map<types.Transport['id'], types.WebRtcTransport<ClientTransportData>>();

  constructor(config: WebRtcConfig) {
    this.initialize(config);
  }

  private async initialize(config: WebRtcConfig) {
    this.#worker = await createWorker({
      logLevel: 'warn',
      logTags: ['rtp', 'ice']
    });

    // TODO: Configurable
    this.#webrtcServer = await this.#worker.createWebRtcServer({
      listenInfos: config.listens
    });

    this.#router = await this.#worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          preferredPayloadType: 109,
          parameters: {
            usedtx: 1
          }
        }
      ]
    });
  }

  async publish(station: Station) {
    const transport = await this.#router.createDirectTransport();

    const exciter = new RTCExciter(station, transport);

    exciter.start(this.#dispatcher)

    this.#published.set(station, exciter);
  }

  unpublish(station: Station) {
    if (this.#published.has(station)) {
      const player = this.#published.get(station)!
      player.stop();

      this.#published.delete(station);
    }
  }

  getCaps() {
    return this.#router.rtpCapabilities;
  }

  async newClientTransport(sctpCaps: types.SctpCapabilities, socket: Socket<{}>): Promise<ClientTransportInfo> {
    const disconnectHandler = () => transport.close();

    const transport = await this.#router.createWebRtcTransport<ClientTransportData>({
      webRtcServer: this.#webrtcServer,
      enableTcp: true,
      enableUdp: true,
      preferTcp: true,
      enableSctp: true,
      numSctpStreams: sctpCaps.numStreams,
      appData: {
        socket,
        disconnectHandler
      }
    });

    this.#transport.set(transport.id, transport);

    socket.once('disconnect', disconnectHandler);

    transport.on('@close', () => {
      console.log('transport', transport.id, '@close');
      this.#transport.delete(transport.id);

      const { stationId } = transport.appData;

      if (stationId) {
        const station = this.#stationFromId(stationId);

        station?.removeAudience(
          makeAudienceGroupId(AudienceType.Web, `rtc`),
          transport.id
        );
      }
    });

    return {
      id: transport.id,
      ice: {
        candidates: transport.iceCandidates,
        params: transport.iceParameters,
      },
      dtls: transport.dtlsParameters,
      sctp: transport.sctpParameters
    }
  }

  async closeClientTransport(transportId: string) {
    const transport = this.#transport.get(transportId);
    if (!transport) {
      return;
    }

    const { socket, disconnectHandler } = transport.appData;

    socket.off('disconnect', disconnectHandler);

    transport.close();
  }

  #stationFromId(stationId: Station['id']) {
    return [...this.#published.keys()].find(s => s.id === stationId);
  }

  async initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id']): Promise<ClientConsumerInfo | undefined> {
    const station = this.#stationFromId(stationId);
    if (!station) {
      return;
    }

    const exciter = this.#published.get(station);
    if (!exciter) {
      return;
    }

    const transport = this.#transport.get(transportId);
    if (!transport) {
      return;
    }

    const { producerId, audioLevelDataProducerId } = exciter;

    if (!producerId) {
      return;
    }

    transport.appData.stationId = stationId;

    station.addAudience(
      makeAudienceGroupId(AudienceType.Web, `rtc`),
      transportId
    );

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: clientCaps
    });

    const audioLevelDataConsumer = audioLevelDataProducerId ? await transport.consumeData({ dataProducerId: audioLevelDataProducerId }) : undefined;

    return {
      rtp: {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      },
      audioLevelData: audioLevelDataConsumer ? {
        id: audioLevelDataConsumer.id,
        dataProducerId: audioLevelDataConsumer.dataProducerId,
        label: audioLevelDataConsumer.label,
        sctpStreamParameters: audioLevelDataConsumer.sctpStreamParameters,
      } : undefined
    }
  }

  async startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters) {
    const transport = this.#transport.get(transportId);
    if (!transport) {
      return;
    }

    await transport.connect({ dtlsParameters });
  }
}
