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

  private defaultStation!: Station;

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
    this.defaultStation = new Station({
      id: 'default',
      name: 'Default station',
      useNullAudioDevice: false,
      musicDb: this._musicDb!
    });

    for (const desc of musicCollections) {
      if (!desc.auxiliary) {
        await this.defaultStation.library.addCollection(desc);
      }
    }

    this.defaultStation.updateSequence(sequences);
    this.defaultStation.sweeperInsertionRules = sweeperRules;

    this.register('station', 'default', new ExposedStation(this.defaultStation));

    // TODO: Register a demo automaton

    this.emit('ready');
  }

  private mongoDBConfigHandlers: ExposedConfigCallback = {
    onMongoDB: () => this.connectMongoDB()
  }

  private async connectMongoDB() {
    console.log('Connecting to MongoDB');

    try {
      const newInstance = await new MongoMusicDb().init({
        ...this.config.mongodb,
        ttls: [60 * 60 * 24 * 7, 60 * 60 * 24 * 12]
      });

      this._musicDb?.dispose();
      this._musicDb = newInstance;
    }
    catch (e) {
      console.log('connectMongoDB Error', e);
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

