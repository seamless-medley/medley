import { noop } from "lodash";

import { createLogger } from "../logging";

import { MusicDbClient } from "../db";
//
import type { Config } from "../config";
//
import { Socket, SocketServer, SocketServerController } from "./socket";
import type { RemoteObjects } from "@seamless-medley/remote";
//
import { ExposedStation } from "./expose/core/station";
import { ExposedCollection } from "./expose/core/collection";
import { ExposedDeck } from "./expose/core/deck";
import { AudioWebSocketServer } from "./audio/ws/server";
import { RTCTransponder } from "./audio/rtc/transponder";
import { ExposedTransponder } from "./expose/rtc/transponder";
import { createAutomaton, createStation } from "../helper";
import { StationConfig } from "../config/station";
import { MedleyAutomaton } from "../discord/automaton";
import { AutomatonConfig } from "../config/automaton";
import { StreamingConfig } from "../config/streaming";
import { StreamingAdapter } from "../streaming/types";
import { ShoutAdapter } from "../streaming";
import { IcyAdapter } from "../streaming";
import { UserModel } from '../db/models/user';
import { retryable, RetryOptions } from "@seamless-medley/utils";
import { ExposedGlobal } from "./expose/core/global";
import { MusicDb, Station, StationEvents } from "../core";
import { Db } from "../db/db";
import { WebRtcConfig } from "../config/webrtc";

const logger = createLogger({ name: 'medley-server' });

type Unpacked<T> = T extends (infer U)[] ? U : T;

export type MedleyServerOptions = {
  io: SocketServer;
  audioServer: AudioWebSocketServer;
  configs: Config;
}

export class MedleyServer extends SocketServerController<RemoteObjects> {
  #musicDb!: MusicDbClient;

  #db!: Db;

  #audioServer: AudioWebSocketServer;

  #rtcTransponder?: RTCTransponder;

  #configs: Config;

  #stations = new Map<string, Station>;

  #automatons = new Map<string, MedleyAutomaton>;

  #streamers = new Set<StreamingAdapter<any>>;

  constructor(options: MedleyServerOptions) {
    super(options.io);
    //
    this.#audioServer = options.audioServer;
    this.#configs = options.configs;
    //
    this.#connectMongoDB().then(this.#initialize);
  }

  #initialize = async () => {
    this.register('global', '$', new ExposedGlobal(this));

    const webrtcConfig: WebRtcConfig = this.#configs.webrtc ?? { listens: [], bitrate: 256 };

    const listens = [...webrtcConfig.listens];

    if (!listens.length) {
      const isInDocker = process.env.MEDLEY_IN_DOCKER !== undefined;

      const loopback = '127.0.0.1';
      const ip = isInDocker ? '0.0.0.0' : loopback;
      const announcedIp = isInDocker ? (process.env.MEDLEY_DEFAULT_RTC_IP || loopback) : undefined;
      const port = isInDocker ? +(process.env.MEDLEY_DEFAULT_RTC_PORT || 9989) : undefined;

      listens.push(
        { protocol: 'tcp', ip, announcedIp, port },
        { protocol: 'udp', ip, announcedIp, port }
      );
    }

    this.#rtcTransponder =  await new RTCTransponder()
      .initialize({
        ...webrtcConfig,
        listens
      })
      .catch((error) => {
        logger.error(error);
        return undefined;
      });

    if (this.#rtcTransponder) {
      this.register('transponder', '~', new ExposedTransponder(this.#rtcTransponder));
    }

    this.#stations = await this.#createStations();
    this.#automatons = await this.#createAutomatons();
    this.#streamers = await this.#createStreamers();

    this.emit('ready');
  }

  async createStation(id: string, config: StationConfig) {
    logger.info(`Constructing station: ${id}`);

    const station = await createStation({
      ...config,
      id,
      musicDb: this.musicDb
    });

    this.registerStation(station);
    this.#audioServer.publish(station);
    this.#rtcTransponder?.publish(station);

    return station;
  }

  removeStation(station: Station) {
    if (this.#stations.get(station.id) !== station) {
      return false;
    }

    this.#stations.delete(station.id);
    this.deregisterStation(station);
    this.#audioServer.unpublish(station);
    this.#rtcTransponder?.unpublish(station);
    return true;
  }

  async #createStations() {
    const stations = await Promise.all(
      Object.entries(this.#configs.stations)
        .map(args => this.createStation(...args)
    ));

    logger.info('Completed stations construction');

    return new Map<string, Station>(stations.map(s => [s.id, s]));
  }

  get stations() {
    return this.#stations;
  }

  async createAutomaton(id: string, config: AutomatonConfig) {
    return createAutomaton({
      ...config,
      id,
      createdStations: Array.from(this.#stations.values())
    });
  }

  removeAutomaton(automaton: MedleyAutomaton) {
    if (this.#automatons.get(automaton.id) !== automaton) {
      return false;
    }

    this.#automatons.delete(automaton.id);
    automaton.destroy();
    return true;
  }

  async #createAutomatons() {
    const automatons = await Promise.all(
      Object.entries(this.#configs.automatons)
        .map(args => this.createAutomaton(...args)
    ));

    logger.info('Started');

    return new Map<string, MedleyAutomaton>(automatons.map(s => [s.id, s]));
  }

  async #streamerFactory(config: StreamingConfig): Promise<StreamingAdapter<any> | undefined> {
    const station = this.#stations.get(config.station);

    if (!station) {
      return;
    }

    switch (config.type) {
      case 'shout':
        return new ShoutAdapter(station, {
          outputFormat: config.format.codec,
          sampleRate: config.format.sampleRate,
          bitrate: (config.format.codec !== 'flac') ? config.format.bitrate : undefined,
          icecast: {
            host: config.icecast.host,
            port: config.icecast.port,
            tls: config.icecast.tls,
            mountpoint: config.icecast.mountpoint || `/${station.id}`,
            username: config.icecast.username,
            password: config.icecast.password,
            url: station.url ?? 'https://github.com/seamless-medley/medley',
            name: station.name,
            description: station.description
          },
          fx: config.fx
        });

      case 'icy':
        return new IcyAdapter(station, {
          outputFormat: config.format.codec,
          sampleRate: config.format.sampleRate,
          bitrate: config.format.bitrate,
          metadataInterval: config.metadataInterval,
          mountpoint: config.mountpoint,
          fx: config.fx
        });

      default:
        return
    }
  }

  async createStreamer(config: StreamingConfig): Promise<StreamingAdapter<any> | undefined> {
    const station = this.#stations.get(config.station);

    if (!station) {
      return;
    }

    const streamer = await this.#streamerFactory(config);
    if (!streamer) {
      return;
    }

    await streamer.init().catch(noop);

    return streamer;
  }

  async #createStreamers() {
    if (!this.#configs.streaming?.length) {
      return new Set<StreamingAdapter<any>>();
    }

    const adapters = await Promise.all(this.#configs.streaming.map((config) => this.createStreamer(config)));
    return new Set(adapters.filter((a): a is StreamingAdapter<any> => a !== undefined));
  }

  async #connectMongoDB() {
    const musicDb = new MusicDbClient();
    const db = new Db();

    const retryOptions: RetryOptions = {
      wait: 3_000,
      maxWait: 30_000,
      onError: (e) => {
        if (e.msg) {
          logger.error(e.msg);
        }
      }
    }

    await retryable(async ({ attempts }) => {
      if (attempts) {
        logger.info('Attempting to re-initialize database connections (%d)', attempts);
      }

      const dbConfig = this.#configs.db;

      await musicDb.init({
        url: dbConfig.url,
        database: dbConfig.database,
        connectionOptions: dbConfig.connectionOptions
      });

      await db.init({
        url: dbConfig.url,
        database: dbConfig.database,
        connectionOptions: dbConfig.connectionOptions,
        seed: process.env.NODE_ENV === 'development'
      });
    }, retryOptions);

    this.#musicDb = musicDb;
    this.#db = db;
  }

  protected override async authenticateSocket(socket: Socket, username: string, password: string) {
    const user = await this.#db.verifyLogin(username, password);
    return user ? new UserModel(user) : undefined;
  }

  get musicDb(): MusicDb {
    return this.#musicDb;
  }

  get streamers() {
    return Array.from(this.#streamers);
  }

  terminate() {
    this.io.close();
    this.#musicDb?.dispose();
  }

  registerStation(station: Station) {
    station.on('collectionAdded', this.#handleStationCollectionAdded);
    station.on('collectionRemoved', this.#handleStationCollectionRemoved);

    this.register('station', station.id, new ExposedStation(station));

    for (const index of [0, 1, 2]) {
      this.register('deck', `${station.id}/${index}`, new ExposedDeck(station, index));
    }

    for (const col of station.collections) {
      this.registerCollection(col);
    }
  }

  deregisterStation(station: Station) {
    station.off('collectionAdded', this.#handleStationCollectionAdded);
    station.off('collectionRemoved', this.#handleStationCollectionRemoved);

    this.deregister('station', station.id);

    for (const index of [0, 1, 2]) {
      this.deregister('deck', `${station.id}/${index}`);
    }

    for (const col of station.collections) {
      this.deregisterCollection(col);
    }
  }

  #handleStationCollectionAdded: StationEvents['collectionAdded'] = (collection) => {
    this.registerCollection(collection);
  }

  #handleStationCollectionRemoved: StationEvents['collectionAdded'] = (collection) => {
    this.deregisterCollection(collection);
  }

  /**
   * A collection is registered with station namespace
   */
  registerCollection(collection: Unpacked<Station['collections']>) {
    const station = collection.extra.owner;
    this.register('collection', `${station.id}/${collection.id}`, new ExposedCollection(collection));
  }

  deregisterCollection(collection: Unpacked<Station['collections']>) {
    const station = collection.extra.owner;
    this.deregister('collection', `${station.id}/${collection.id}`);
  }
}

/**
 * List of Stations
 *  |- Station // Partially done
 *    |- Intro
 *    |- Sweeper Rule[]
 *    |- Request Sweeper[]
 *    |- Music Collection // Partially done
 *    |- Crate/Sequence
 *    |- Settings
 *    |- Audience Report
 *    |- Search
 *      |- Auto suggest
 *    |- Requests
 *
 * List of Automaton
 *  |- Automaton
 *    |- Roles
 *    |- Discord Server
 *    |- Settings
 */
