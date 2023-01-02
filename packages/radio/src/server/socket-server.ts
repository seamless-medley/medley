import { MusicCollectionDescriptor, MusicDb, SequenceConfig, Station } from "@seamless-medley/core";
import { MongoMusicDb, Options as MongoDBOptions } from "../musicdb/mongo";
import { SocketServer, SocketServerController } from "../socket";
import { ExposedTick, RemoteTypes } from "../socket/remote";
import { Config } from "../socket/remote/config";
import { ExposedConfig, ExposedConfigCallback } from "./expose/config";
import { ExposedStation } from "./expose/station";

const musicCollections: MusicCollectionDescriptor[] = [
  { id: 'bright', description:'Bright', path: 'D:\\vittee\\Google Drive\\musics\\bright' },
  { id: 'brokenhearted', description:'Broken Hearted', path: 'D:\\vittee\\Google Drive\\musics\\brokenhearted' },
  { id: 'chill', description:'Chill', path: 'D:\\vittee\\Google Drive\\musics\\chill' },
  { id: 'groovy', description:'Groovy', path: 'D:\\vittee\\Google Drive\\musics\\groovy' },
  { id: 'hurt', description:'Hurt', path: 'D:\\vittee\\Google Drive\\musics\\hurt' },
  { id: 'lonely', description:'Lonely', path: 'D:\\vittee\\Google Drive\\musics\\lonely' },
  { id: 'lovesong', description:'Love Song', path: 'D:\\vittee\\Google Drive\\musics\\lovesong' },
  { id: 'joyful', description:'Joyful', path: 'D:\\vittee\\Google Drive\\musics\\joyful' },
  { id: 'upbeat', description:'Upbeat', path: 'D:\\vittee\\Google Drive\\musics\\upbeat' },
  { id: 'new-released', description:'New Released', path: 'D:\\vittee\\Google Drive\\musics\\new-released', disableLatch: true, noFollowOnRequest: true },
  { id: 'thai', auxiliary: true, description:'Thai', path: 'M:\\Repository\\th' },
  { id: 'inter', auxiliary: true, description:'International', path: 'M:\\Repository\\inter' },
];

const sequences: SequenceConfig[] = [
  { crateId: 'guid1', collections: [ { id: 'new-released' }], chance: 'random', limit: { by: 'one-of', list: [1, 1, 1, 2] } },
  { crateId: 'guid2', collections: [ { id: 'bright' }], chance: [1, 2], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid3', collections: [ { id: 'joyful' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid4', collections: [ { id: 'upbeat' }], chance: [2, 4], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid5', collections: [ { id: 'groovy' }], chance: [1, 3], limit: 1 },
  { crateId: 'guid7', collections: [ { id: 'chill' }], limit: { by: 'range', range: [2, 3] } },
  { crateId: 'guid8', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid9',
    collections: [
      { id: 'lonely', weight: 1 },
      { id: 'brokenhearted', weight: 0.5 }
    ],
    limit: { by: 'upto', upto: 1 }
  },
  { crateId: 'guid10', collections: [ { id: 'brokenhearted' }], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid11', collections: [ { id: 'hurt' }], chance: [1, 2], limit: { by: 'upto', upto: 1 } },
  { crateId: 'guid12', collections: [ { id: 'lonely' }], limit: { by: 'range', range: [1, 2] } },
  { crateId: 'guid13', collections: [ { id: 'lovesong' }], limit: { by: 'upto', upto: 2 } },
  { crateId: 'guid14', collections: [ { id: 'chill' }], chance: [1, 1], limit: { by: 'upto', upto: 2 } }
];

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
    this.register('tick', '', new ExposedTick());

    this.connectMongoDB().then(async () => {
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

      this.register('station', 'default', new ExposedStation(this.defaultStation));

    // TODO: Register a demo automaton
    })

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

