import { MusicDb, Station} from "@seamless-medley/core";
import { MongoMusicDb, Options as MongoDBOptions } from "../musicdb/mongo";
import { SocketServer, SocketServerController } from "../socket";
import { RemoteTypes } from "../socket/remote";
import { Config } from "../socket/remote/config";
import { ExposedConfig, ExposedConfigCallback } from "./expose/config";
import { ExposedStation } from "./expose/station";
import { musicCollections, sequences, sweeperRules } from "../fixtures";

export class Server extends SocketServerController<RemoteTypes> {
  private config: Config;

  private _musicDb: MusicDb | undefined;

  private testStation!: Station;

  constructor(io: SocketServer) {
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

    // this.register('config', '', this.config);
    // this.register('tick', '', new ExposedTick());

    this.connectMongoDB().then(this.initialize);
  }

  private initialize = async () => {
    this.testStation = new Station({
      id: 'ui-test',
      name: 'Default station',
      useNullAudioDevice: false,
      musicDb: this._musicDb!
    });

    for (const desc of musicCollections) {
      if (!desc.auxiliary) {
        await this.testStation.library.addCollection(desc);
      }
    }

    this.testStation.updateSequence(sequences);
    this.testStation.sweeperInsertionRules = sweeperRules;

    this.register('station', 'default', new ExposedStation(this.testStation));

    // TODO: Register a demo automaton

    this.emit('ready');
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
    }
    catch (e) {
      throw e;
    }
  }

  private get musicDb() {
    return this._musicDb;
  }
}

/**
 * List of Stations
 *  |- Station
 *    |- Intro
 *    |- Sweeper Rule[]
 *    |- Request Sweeper[]
 *    |- Music Collection
 *    |- Crate/Sequence
 *
 * List of Automaton
 *  |- Automaton
 *    |- Station Registry
 */

