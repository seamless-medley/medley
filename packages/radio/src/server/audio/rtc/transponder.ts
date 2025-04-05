import { AudienceType, makeAudienceGroupId, type Station } from '@seamless-medley/core';
import { type types, createWorker } from 'mediasoup';
import { TypedEmitter } from 'tiny-typed-emitter';
import { Socket } from 'socket.io';
import { RTCExciter } from './exciter';
import { AudioDispatcher } from '../../../audio/exciter';
import { type WebRtcConfig } from '../../../config/webrtc';
import { createLogger } from '@seamless-medley/logging';

type ConsumerResponse = Pick<types.Consumer, 'id' | 'producerId' | 'kind' | 'rtpParameters'>;;
type DataConsumerResponse = Pick<types.DataConsumer, 'id' | 'dataProducerId' | 'label' | 'sctpStreamParameters'>;;

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

export type ClientTransportData = {
  socket: Socket<{}>;
  disconnectHandler: () => void;
  closeHandler: () => void;
  routerCloseHandler: () => void;
  stationId?: string;
  consumer?: types.Consumer<ClientConsumerData>;
}

export type ClientConsumerData = {
  closeHandler: () => void;
  transport: types.WebRtcTransport<ClientTransportData>;
  stationId: string;
}

export type ClientConsumerInfo = {
  rtp: ConsumerResponse;
  audioLevelData?: DataConsumerResponse;
  eventData?: DataConsumerResponse;
  audioLatencyMs: number;
}

interface RTCTransponderEvents {
  renew: () => void;
}

export class RTCTransponder extends TypedEmitter<RTCTransponderEvents> {
  #dispatcher = new AudioDispatcher();

  #worker!: types.Worker;
  #webrtcServer!: types.WebRtcServer;
  #router!: types.Router;
  #nullDirectTransport!: types.DirectTransport;
  #nullDataProducer!: types.DataProducer;

  #published = new Map<Station, RTCExciter>();

  #transports = new Map<types.Transport['id'], types.WebRtcTransport<ClientTransportData>>();

  #bitrate = 256_000;
  #listens: WebRtcConfig['listens'] = [];

  #logger = createLogger({ name: 'rtc-transponder' });

  async initialize(config: WebRtcConfig): Promise<this> {
    this.#bitrate = config.bitrate * 1000;
    this.#listens = config.listens;

    await this.#internalInitialize();

    return this;
  }

  async #internalInitialize() {
    this.#worker = await createWorker({
      logLevel: 'warn',
      logTags: ['rtp', 'ice']
    });

    const fatalHandler = async () => {
      this.#worker.off('died', fatalHandler);
      await this.#internalInitialize();

      // re-publish
      this.#logger.debug('Re-publish');

      for (const exciter of this.#published.values()) {
        exciter.stop();
      }

      await Promise.all(Array.from(this.#published.keys()).map(station => this.publish(station)));

      this.emit('renew');
    }

    this.#worker.on('died', fatalHandler);

    this.#webrtcServer = await this.#worker.createWebRtcServer({
      listenInfos: this.#listens
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

    this.#nullDirectTransport = await this.#router.createDirectTransport();
    this.#nullDataProducer = await this.#nullDirectTransport.produceData({
      label: 'null',
      protocol: 'none'
    });

    this.#transports.clear();
  }

  async publish(station: Station) {
    const transport = await this.#router.createDirectTransport();

    const exciter = new RTCExciter({
      station,
      transport,
      bitrate: this.#bitrate
    });

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
    const transport = await this.#router.createWebRtcTransport<ClientTransportData>({
      webRtcServer: this.#webrtcServer,
      enableTcp: true,
      enableUdp: true,
      preferTcp: true,
      enableSctp: true,
      numSctpStreams: sctpCaps.numStreams
    });

    const disconnectHandler = () => {
      this.#logger.debug('Closing transport due to socket disconnection');
      transport.close();
    }

    socket.once('disconnect', disconnectHandler);

    const routerCloseHandler = () => {
      this.#logger.debug('routerCloseHandler');

      this.#removeClientTransport(transport);

      if (!transport.closed) {
        transport.close();
      }
    }

    transport.once('routerclose', routerCloseHandler);

    const closeHandler = () => {
      this.#logger.debug('transport @close');
      this.#removeClientTransport(transport);
    }

    transport.once('@close', closeHandler);

    transport.appData = {
      socket,
      disconnectHandler,
      closeHandler,
      routerCloseHandler
    }

    this.#transports.set(transport.id, transport);

    const nullConsumer = await transport.consumeData({ dataProducerId: this.#nullDataProducer.id });

    return {
      id: transport.id,
      ice: {
        candidates: transport.iceCandidates,
        params: transport.iceParameters,
      },
      dtls: transport.dtlsParameters,
      sctp: transport.sctpParameters,
      tester: {
        id: nullConsumer.id,
        dataProducerId: nullConsumer.dataProducerId,
        label: nullConsumer.label,
        sctpStreamParameters: nullConsumer.sctpStreamParameters
      }
    }
  }

  #removeClientTransport(transport: types.WebRtcTransport<ClientTransportData>) {
    const deleted = this.#transports.delete(transport.id);
    if (!deleted) {
      return;
    }

    this.#logger.debug('removing transport');

    const { closeHandler, routerCloseHandler, disconnectHandler, socket, consumer } = transport.appData;

    transport.off('routerclose', routerCloseHandler);
    transport.off('@close', closeHandler);
    socket.off('disconnect', disconnectHandler);

    if (consumer) {
      consumer.off('@close', consumer.appData.closeHandler);
    }

    this.#removeStationAudience(transport);
  }

  #removeStationAudience(transport: types.WebRtcTransport<ClientTransportData>) {
    const { stationId } = transport.appData;

    if (stationId) {
      const station = this.#stationFromId(stationId);

      this.#logger.debug('removing transport from station audience');

      station?.removeAudience(
        makeAudienceGroupId(AudienceType.Web, `rtc`),
        transport.id
      );
    }
  }

  async closeClientTransport(transportId: string) {
    const transport = this.#transports.get(transportId);
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

    const transport = this.#transports.get(transportId);
    if (!transport) {
      return;
    }

    const { producerId, audioLevelDataProducerId, eventDataProducerId } = exciter;

    if (!producerId) {
      return;
    }

    if (!exciter.started) {
      await exciter.start(this.#dispatcher);
    }

    station.addAudience(
      makeAudienceGroupId(AudienceType.Web, `rtc`),
      transportId
    );

    const consumer = await transport.consume<ClientConsumerData>({
      producerId,
      rtpCapabilities: clientCaps
    });

    const closeHandler = () => {
      this.#logger.debug('Consumer @close');
      this.#removeStationAudience(transport);
      transport.appData.consumer = undefined;
    }

    consumer.once('@close', closeHandler);

    consumer.appData = {
      closeHandler,
      transport,
      stationId
    }

    transport.appData = {
      ...transport.appData,
      stationId,
      consumer
    }

    const audioLevelDataConsumer = audioLevelDataProducerId
      ? await transport.consumeData({ dataProducerId: audioLevelDataProducerId })
      : undefined;

    const eventDataConsumer = eventDataProducerId
      ? await transport.consumeData({ dataProducerId: eventDataProducerId })
      : undefined;

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
      } : undefined,

      eventData: eventDataConsumer ? {
        id: eventDataConsumer.id,
        dataProducerId: eventDataConsumer.dataProducerId,
        label: eventDataConsumer.label,
        sctpStreamParameters: eventDataConsumer.sctpStreamParameters,
      } : undefined,

      audioLatencyMs: exciter.audioLatencyMs
    }
  }

  async startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters) {
    const transport = this.#transports.get(transportId);
    if (!transport) {
      return;
    }

    await transport.connect({ dtlsParameters });
  }

  async stopClientConsumer(transportId: string) {
    const transport = this.#transports.get(transportId);
    if (!transport) {
      return;
    }

    const { consumer } = transport.appData;
    if (!consumer) {
      return;
    }

    consumer.close();
  }
}
