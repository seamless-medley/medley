import { MusicDb, Station, StationEvents } from "@seamless-medley/core";
import { createLogger } from "@seamless-medley/logging";

import { MongoMusicDb } from "../musicdb/mongo";
//
import type { Config } from "../config";
//
import { Socket, SocketServer, SocketServerController } from "./socket";
import type { RemoteTypes } from "../remotes";
import type { Unpacked } from "../types";
//
import { ExposedStation } from "./expose/core/station";
import { ExposedColection } from "./expose/core/collection";
import { ExposedDeck } from "./expose/core/deck";
import { AudioWebSocketServer } from "./audio/ws/server";
import { RTCTransponder } from "./audio/rtc/transponder";
import { ExposedTransponder } from "./expose/rtc/transponder";
import { createAutomaton, createStation } from "../helper";

const logger = createLogger({ name: 'medley-server' });

export type MedleyServerOptions = {
  io: SocketServer;
  audioServer: AudioWebSocketServer;
  rtcTransponder?: RTCTransponder;
  configs: Config;
}

export class MedleyServer extends SocketServerController<RemoteTypes> {

  #musicDb!: MusicDb;

  #audioServer: AudioWebSocketServer;

  #rtcTransponder?: RTCTransponder;

  #configs: Config;

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
    if (this.#rtcTransponder) {
      this.register('transponder', '~', new ExposedTransponder(this.#rtcTransponder));
    }

    const stations = await Promise.all(
      Object.entries(this.#configs.stations).map(async ([stationId, stationConfig]) => {
        logger.info(`Constructing station: ${stationId}`);

        const station = await createStation({
          ...stationConfig,
          id: stationId,
          musicDb: this.musicDb
        });

        this.registerStation(station);
        this.#audioServer.publish(station);
        this.#rtcTransponder?.publish(station);

        return station;
      })
    );

    logger.info('Completed stations construction');

    const automatons = await Promise.all(
      Object.entries(this.#configs.automatons).map(([id, config]) => createAutomaton({
        ...config,
        id,
        createdStations: stations
      }))
    );

    if (automatons.some(a => !a.isReady)) {
      logger.warn('Started, with some malfunctioning automatons');
    } else {
      logger.info('Started');
    }

    this.emit('ready');
  }

  protected override addSocket(socket: Socket) {
    super.addSocket(socket);
    logger.debug({ id: socket.id }, 'Adding socket');
  }

  async #connectMongoDB() {
    const dbConfig = this.#configs.db;

    try {
      const newInstance = await new MongoMusicDb().init({
        url: dbConfig.url,
        database: dbConfig.database,
        connectionOptions: dbConfig.connectionOptions,
        ttls: [
          dbConfig.metadataTTL?.min ?? 60 * 60 * 24 * 7,
          dbConfig.metadataTTL?.max ?? 60 * 60 * 24 * 12,
        ]
      });

      this.#musicDb?.dispose();
      this.#musicDb = newInstance;

      logger.info('Connected to MongoDB');
    }
    catch (e) {
      throw e;
    }
  }

  get musicDb() {
    return this.#musicDb;
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
    this.register('collection', `${station.id}/${collection.id}`, new ExposedColection(collection));
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

