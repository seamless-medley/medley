import { MusicDb, Station, StationEvents} from "@seamless-medley/core";
import { MongoMusicDb } from "../musicdb/mongo";
import { Socket, SocketServer, SocketServerController } from "../socket";
import { RemoteTypes } from "../socket/remote";
import { Config } from "../socket/remote/config";
import { ExposedConfig, ExposedConfigCallback } from "./expose/config";
import { ExposedStation } from "./expose/station";

import {
  musicCollections,
  sequences,
  sweeperRules
} from "../fixtures";

import { ExposedColection } from "./expose/collection";
import { Unpacked } from "../types";
import { AudioServer } from "./audio/transport";
import { ExposedDeck } from "./expose/deck";

export class MedleyServer extends SocketServerController<RemoteTypes> {
  private config: Config;

  private _musicDb: MusicDb | undefined;

  private demoStation!: Station;

  constructor(io: SocketServer, private audioServer: AudioServer) {
    super(io);

    this.config = new ExposedConfig({
      mongodb: {
        database: 'medley',
        url: 'mongodb://localhost:27017',
        connectionOptions: {
          auth: {
            username: 'root',
            password: 'example'
          }
        }
      }
    }, this.mongoDBConfigHandlers);

    this.connectMongoDB().then(this.initialize);
  }

  private initialize = async () => {
    this.demoStation = new Station({
      id: 'demo',
      name: 'Demo station',
      useNullAudioDevice: true,
      musicDb: this._musicDb!
    });

    for (const desc of musicCollections) {
      if (!desc.auxiliary) {
        await this.demoStation.addCollection(desc);
      }
    }

    this.demoStation.updateSequence(sequences);
    this.demoStation.sweeperInsertionRules = sweeperRules;

    this.registerStation(this.demoStation);

    this.audioServer.publish(this.demoStation);

    // TODO: Register a demo automaton

    this.emit('ready');
  }

  protected override addSocket(socket: Socket) {
    super.addSocket(socket);
    console.log('Adding socket', socket.id);
  }

  private mongoDBConfigHandlers: ExposedConfigCallback = {
    onMongoDB: () => this.connectMongoDB()
  }

  private async connectMongoDB() {
    try {
      const newInstance = await new MongoMusicDb().init({
        ...this.config.mongodb,
        ttls: [60 * 60 * 24 * 7, 60 * 60 * 24 * 12]
      });

      this._musicDb?.dispose();
      this._musicDb = newInstance;

      console.log('Connected to MongoDB');
    }
    catch (e) {
      throw e;
    }
  }

  get musicDb() {
    return this._musicDb;
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

