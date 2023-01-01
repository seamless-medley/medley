import { MusicDb } from "@seamless-medley/core";
import { MongoMusicDb, Options as MongoDBOptions } from "../musicdb/mongo";
import { SocketServer, SocketServerController } from "../socket";
import { RemoteTypes } from "../socket/remote";
import { Config } from "../socket/remote/config";
import { MixinEventEmitterOf, Exposable, PickProp } from "../socket/types";

export class Server extends SocketServerController<RemoteTypes> {
  private config: Config;

  private _musicDb: MusicDb | undefined;

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
    }, this.mongoDBConfigHandlers) as unknown as Config;

    this.connectMongoDB();
    this.register('config', '', this.config);
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

type ExposedConfigCallback = {
  onMongoDB(): Promise<void>;
}

// @ts-ignore
class ExposedConfig extends MixinEventEmitterOf<Config>() implements Exposable<Config> {
  private _mongodb: MongoDBOptions;

  constructor(config: PickProp<Config>, private handler: ExposedConfigCallback) {
    super();

    this._mongodb = config.mongodb;
  }

  get mongodb() {
    return this._mongodb;
  }

  async asyncSetMongodb(value: MongoDBOptions) {
    this._mongodb = value;
    return this.handler.onMongoDB();
  }
}

// class ExposedCounter extends MixinEventEmitterOf<RemoteCounter>() implements Exposable<RemoteCounter> {
//   _count = 0;

//   get count() {
//     return this._count;
//   }

//   set count(v) {
//     this._count = v;
//   }

//   inc(amount: number = 1) {
//     this.count += amount;
//     this.emit('increased', this.count);
//   }

//   reset(to: number) {
//     return this.count = to;
//   }

//   // test = () => {
//   //   return this._count;
//   // }
// }


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

