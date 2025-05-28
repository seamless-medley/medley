import { noop } from "lodash";

import { createLogger } from "../logging";

import { SettingsDb } from '../db/types';
import { MongoMusicDb } from "../db/musicdb/mongo";
//
import type { Config } from "../config";
//
import { Socket, SocketServer, SocketServerController } from "./socket";
import type { RemoteTypes } from "../remotes";
import type { Unpacked } from "../types";
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
import { retryable } from "@seamless-medley/utils";
import { ExposedGlobal } from "./expose/core/global";
import { MusicDb, Station, StationEvents } from "../core";

const logger = createLogger({ name: 'medley-server' });

export type MedleyServerOptions = {
  io: SocketServer;
  audioServer: AudioWebSocketServer;
  rtcTransponder?: RTCTransponder;
  configs: Config;
}

export class MedleyServer extends SocketServerController<RemoteTypes> {
  #instanceName = 'Medley';

  #musicDb!: MusicDb;

  #settingsDb!: SettingsDb;

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
    this.#rtcTransponder = options.rtcTransponder;
    this.#configs = options.configs;
    //
    this.#connectMongoDB().then(this.#initialize);
  }

  #initialize = async () => {
    this.register('global', '$', new ExposedGlobal(this));

    if (this.#rtcTransponder) {
      this.register('transponder', '~', new ExposedTransponder(this.#rtcTransponder));
    }

    this.#instanceName = this.#configs.instanceName ?? 'Medley';
    logger.info(`Medley server name: "${this.#instanceName}"`);

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

  get instanceName() {
    return this.#instanceName;
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
    const musicDb = new MongoMusicDb();

    await retryable(async ({ attempts }) => {
      if (attempts) {
        logger.info('Attempting to re-initialize database connections (%d)', attempts);
      }

      const dbConfig = this.#configs.db;

      return musicDb.init({
        url: dbConfig.url,
        database: dbConfig.database,
        connectionOptions: dbConfig.connectionOptions,
        ttls: [
          dbConfig.metadataTTL?.min ?? 60 * 60 * 24 * 7,
          dbConfig.metadataTTL?.max ?? 60 * 60 * 24 * 12,
        ]
      });
    },
    {
      wait: 3_000,
      maxWait: 30_000,
      onError: (e) => {
        if (e.msg) {
          logger.error(e.msg);
        }
      }
    });

    this.#musicDb = musicDb;
    this.#settingsDb = musicDb.settings;
  }

  protected override async authenticateSocket(socket: Socket, username: string, password: string) {
    const user = await this.#settingsDb?.verifyLogin(username, password);
    return user ? new UserModel(user) : undefined;
  }

  get musicDb() {
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
