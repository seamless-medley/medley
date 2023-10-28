import { shuffle } from "lodash";
import normalizePath from "normalize-path";
import { MusicDb, Station, StationEvents, StationRegistry, TrackCollection, WatchTrackCollection, createLogger, scanDir } from "@seamless-medley/core";
import { MongoMusicDb } from "../musicdb/mongo";
import { MedleyAutomaton } from "../discord/automaton";
//
import type { Config } from "../config";
//
import { Socket, SocketServer, SocketServerController } from "../socket";
import type { RemoteTypes } from "../remotes";
import type { Unpacked } from "../types";
//
import { ExposedStation } from "./expose/core/station";
import { ExposedColection } from "./expose/core/collection";
import { ExposedDeck } from "./expose/core/deck";
import { AudioWebSocketServer } from "./audio/ws/server";
import { RTCTransponder } from "./audio/rtc/transponder";
import { ExposedTransponder } from "./expose/rtc/transponder";
import { EventEmitter } from "events";

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
    this.connectMongoDB().then(this.initialize);
  }

  private initialize = async () => {
    if (this.#rtcTransponder) {
      this.register('transponder', '~', new ExposedTransponder(this.#rtcTransponder));
    }

    const stations = await Promise.all(
      Object.entries(this.#configs.stations).map(([stationId, stationConfig]) => new Promise<Station>(async (resolve) => {
        const { intros, requestSweepers, musicCollections, sequences, sweeperRules, ...config } = stationConfig;

        logger.info('Constructing station:', stationId);

        const introCollection = intros ? (() => {
          const collection = new TrackCollection('$_intros', undefined, { logPrefix: stationId });
          collection.add(shuffle(intros));
          return collection;
        })() : undefined;

        const requestSweeperCollection = requestSweepers ? (() => {
          const collection = new TrackCollection('$_req_sweepers', undefined, { logPrefix: stationId });
          collection.add(shuffle(requestSweepers));
          return collection;
        })() : undefined;

        const station = new Station({
          id: stationId,
          ...config,
          intros: introCollection,
          requestSweepers: requestSweeperCollection,
          musicDb: this.musicDb
        });

        for (const [id, desc] of Object.entries(musicCollections)) {
          if (!desc.auxiliary) {
            await station.addCollection({
              id,
              ...desc,
              logPrefix: stationId
            });
          }
        }

        station.updateSequence(sequences.map((s, index) => ({
          crateId: `${stationId}/${index}`,
          ...s
        })));

        station.sweeperInsertionRules = (sweeperRules ?? []).map((rule) => ({
          from: rule.from,
          to: rule.to,
          collection: (() => {
            const c = new WatchTrackCollection(rule.path, undefined, { logPrefix: stationId, scanner: scanDir });
            c.watch(normalizePath(rule.path));

            return c;
          })()
        }));

        this.registerStation(station);
        this.#audioServer.publish(station);
        this.#rtcTransponder?.publish(station);

        resolve(station);

        for (const [id, desc] of Object.entries(musicCollections)) {
          if (desc.auxiliary) {
            station.addCollection({
              id,
              ...desc,
              logPrefix: stationId
            });
          }
        }
      }))
    );

    logger.info('Completed stations construction');

    const automatons = await Promise.all(Object.entries(this.#configs.automatons).map(
      ([id, { botToken, clientId, baseCommand, ...config }]) => new Promise<MedleyAutomaton>(async (resolve) => {
        const allowedStations = config.stations?.length ? stations.filter(s => config.stations!.includes(s.id)) : stations;
        const stationRepo = new StationRegistry(...allowedStations);
        const automaton = new MedleyAutomaton(stationRepo, {
          id,
          botToken,
          clientId,
          baseCommand,
          guilds: config.guilds
        });

        automaton.once('ready', () => resolve(automaton));

        await automaton.login();
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
    logger.debug('Adding socket', socket.id);
  }

  private async connectMongoDB() {
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
    station.on('collectionAdded', this.handleStationCollectionAdded);
    station.on('collectionRemoved', this.handleStationCollectionRemoved);

    this.register('station', station.id, new ExposedStation(station));

    for (const index of [0, 1, 2]) {
      this.register('deck', `${station.id}/${index}`, new ExposedDeck(station, index));
    }

    for (const col of station.collections) {
      this.registerCollection(col);
    }
  }

  deregisterStation(station: Station) {
    station.off('collectionAdded', this.handleStationCollectionAdded);
    station.off('collectionRemoved', this.handleStationCollectionRemoved);

    this.deregister('station', station.id);
  }

  private handleStationCollectionAdded: StationEvents['collectionAdded'] = (collection) => {
    this.registerCollection(collection);
  }

  private handleStationCollectionRemoved: StationEvents['collectionAdded'] = (collection) => {
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

