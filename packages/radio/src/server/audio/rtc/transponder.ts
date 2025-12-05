import { cpus } from 'node:os';
import { chain, partition, times } from 'lodash';
import { type types, createWorker } from 'mediasoup';
import { TypedEmitter } from 'tiny-typed-emitter';
import type { ClientConsumerInfo, ClientTransportInfo } from '@seamless-medley/remote';
import { RTCExciter } from './exciter';
import { AudioDispatcher } from '../../../audio/exciter';
import type { ListenInfo, WebRtcConfig } from '../../../config/webrtc';
import { createLogger, Logger } from "../../../logging";
import { AudienceType, makeAudienceGroupId, Station } from '../../../core';
import { type Socket } from '../../socket';

export type ClientTransportData = {
  socket: Socket;
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

interface RTCWorkerEvents {
  restart: (rtcWorker: RTCWorker) => void;
}

interface RTCTransponderEvents extends RTCWorkerEvents {

}

export class RTCWorker extends TypedEmitter<RTCWorkerEvents> {
  #dispatcher = new AudioDispatcher();

  #worker!: types.Worker;
  #webrtcServer!: types.WebRtcServer;
  #router!: types.Router;

  // The null data producer is used to perform RTC connectivity checking
  #nullDirectTransport!: types.DirectTransport;
  #nullDataProducer!: types.DataProducer;

  #published = new Map<Station, RTCExciter>();

  #transports = new Map<types.Transport['id'], types.WebRtcTransport<ClientTransportData>>();

  #bitrate = 256_000;
  #listens: ListenInfo[] = [];

  #logger: Logger;

  constructor(readonly id: string) {
    super();
    this.#logger = createLogger({ name: 'rtc-worker', id });
  }

  async initialize(bitrate: number, listens: ListenInfo[]): Promise<this> {
    this.#bitrate = bitrate;
    this.#listens = listens;

    this.#logger.debug(listens, 'Listens')

    await this.#internalInitialize();
    return this;
  }

  async #internalInitialize() {
    this.#logger.info('Initializing');

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

      this.emit('restart', this);
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
          preferredPayloadType: 109, // Opus payload type
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
    if (!this.#published.has(station)) {
      return;
    }

    const player = this.#published.get(station)!
    player.stop();

    this.#published.delete(station);
  }

  getCaps() {
    return this.#router.rtpCapabilities;
  }

  async newClientTransport(sctpCaps: types.SctpCapabilities, socket: Socket): Promise<ClientTransportInfo> {
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

  #stationFromId(stationId: Station['id']) {
    return [...this.#published.keys()].find(s => s.id === stationId);
  }

  async closeClientTransport(transportId: string, _: Socket) {
    const transport = this.#transports.get(transportId);
    if (!transport) {
      return;
    }

    const { socket, disconnectHandler } = transport.appData;

    socket.off('disconnect', disconnectHandler);

    transport.close();
  }

  async initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id'], socket: Socket): Promise<ClientConsumerInfo | undefined> {
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

  async startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters, socket: Socket) {
    const transport = this.#transports.get(transportId);
    if (!transport) {
      return;
    }

    await transport.connect({ dtlsParameters });
  }

  async stopClientConsumer(transportId: string, socket: Socket) {
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

export class RTCTransponder extends TypedEmitter<RTCTransponderEvents> {
  #workers = new Map<string, RTCWorker>();

  #workerIndex = 0;

  async initialize(config: WebRtcConfig): Promise<this> {
    const listens = distributeListenInfo(config.listens, cpus().length);

    const bitrate = config.bitrate * 1000;

    class WorkerInitializationError extends Error {
      constructor(cause: Error, readonly rtcId: string, readonly infos: WebRtcConfig['listens']) {
        super(cause.message);
      }
    }

    const settledWorkers = await Promise.allSettled(
      listens.map((infos, index) => new Promise<RTCWorker>((resolve, reject) => {
        const id = `${index+1}`;
        const worker = new RTCWorker(id);

        worker.initialize(bitrate, infos)
          .then(resolve)
          .catch(e => reject(new WorkerInitializationError(e, id, infos)))
      }))
    );

    const [succeededWorkers, failedWorkers] = partition(settledWorkers, worker => worker.status === 'fulfilled');

    const logger = createLogger({ name: 'rtc-transponder' });;

    for (const worker of failedWorkers) {
      logger.error(worker.reason);
    }

    const workers = succeededWorkers.map(w => w.value);

    if (!workers.length) {
      throw new Error('No workers have been started');
    }

    for (const worker of workers) {
      worker.on('restart', this.#handleWorkerRestart);
    }

    this.#workers = new Map(workers.map<[string, RTCWorker]>(w => [w.id, w]));

    return this;
  }

  #handleWorkerRestart = (worker: RTCWorker) => {
    this.emit('restart', worker);
  }

  async publish(station: Station) {
    for (const worker of this.#workers.values()) {
      worker.publish(station);
    }
  }

  unpublish(station: Station) {
    for (const worker of this.#workers.values()) {
      worker.unpublish(station);
    }
  }

  getCaps(): Array<[string, types.RtpCapabilities]> {
    const entries = [...this.#workers.entries()];

    const result = entries.map((_, i) => {
      const [rtcId, worker] = entries[(this.#workerIndex + i) % entries.length];
      return [rtcId, worker.getCaps()] as [string, types.RtpCapabilities];
    });

    this.#workerIndex = (this.#workerIndex + 1) % entries.length;

    return result;
  }

  async newClientTransport(workerId: string, sctpCaps: types.SctpCapabilities, socket: Socket): Promise<ClientTransportInfo> {
    const worker = this.#workers.get(workerId);

    if (!worker) {
      throw new Error(`Unknown worker ${workerId}`);
    }

    socket.data.rtcWorker = worker;

    return worker.newClientTransport(sctpCaps, socket);
  }

  async closeClientTransport(transportId: string, socket: Socket) {
    const { rtcWorker } = socket.data;

    if (!rtcWorker) {
      return;
    }

    return rtcWorker.closeClientTransport(transportId, socket);
  }

  async initiateClientConsumer(transportId: string, clientCaps: types.RtpCapabilities, stationId: Station['id'], socket: Socket): Promise<ClientConsumerInfo | undefined> {
    const { rtcWorker } = socket.data;

    if (!rtcWorker) {
      return;
    }

    return rtcWorker.initiateClientConsumer(transportId, clientCaps, stationId, socket);
  }

  async startClientConsumer(transportId: string, dtlsParameters: types.DtlsParameters, socket: Socket) {
    const { rtcWorker } = socket.data;

    if (!rtcWorker) {
      return;
    }

    return rtcWorker.startClientConsumer(transportId, dtlsParameters, socket);
  }

  async stopClientConsumer(transportId: string, socket: Socket) {
    const { rtcWorker } = socket.data;

    if (!rtcWorker) {
      return;
    }

    return rtcWorker.stopClientConsumer(transportId, socket);
  }
}

function ipToLong(ip: string) {
  const octets = ip.split('.').map(o => +o.trim());
  return (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

function isSameIp(a: string, b: string) {
  const [l, r] = [a, b].map(ipToLong);

  return l === r || l === 0 || r === 0;
}

function distributeListenInfo(infos: ListenInfo[], numGroups: number): Array<ListenInfo[]> {
  if (!infos.length || numGroups <= 0) {
    return [];
  }

  return chain(infos)
    .sortBy(({ ip }) => ipToLong(ip))
    .uniqWith((a, b) => {
      if (a.protocol !== b.protocol) {
        return false;
      }

      if (!isSameIp(a.ip, b.ip)) {
        return false;
      }

      return a.port === b.port;
    })
    .groupBy(({ ip, port }) => `${ip}:${port}`)
    .toPairs()
    .reduce((acc, [_, portGroup], index) => (acc[index % numGroups].push(...portGroup), acc), times<ListenInfo[]>(numGroups, () => []))
    .filter(group => group.length > 0)
    .value();
}
