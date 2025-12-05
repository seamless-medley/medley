import { MongoClient, MongoClientOptions, Db as MongoDb } from "mongodb";
import argon2 from '@node-rs/argon2';
import { createLogger, Logger } from "../logging";
import { UserDb } from "./types";
import { User, UserCredential } from "./schema/user";

export type Options = {
  url: string;

  connectionOptions?: MongoClientOptions;

  database: string;

  seed?: boolean;
}

export class Db implements UserDb {
  #logger: Logger;

  #client!: MongoClient;

  #db!: MongoDb;

  constructor() {
    this.#logger = createLogger({
      name: 'db',
      id: `main`
    });
  }

  async init(options: Options): Promise<this> {
    this.#client = new MongoClient(options.url, {
      serverSelectionTimeoutMS: 5000,
      ...options.connectionOptions
    });

    await this.#client.connect();

    this.#db = this.#client.db(options.database);

    if (options.seed) {
      const hasUsers = await this.#db.listCollections().toArray().then(all => all.find(c => c.name === 'users') !== undefined);

      if (!hasUsers) {
        argon2.hash('admin').then((password) => {
          const users = this.#db.collection('users');
          users.createIndexes([
            { key: { username: 1 } }
          ]);
          users.insertOne({ username: 'admin', password });
        });
      }
    }

    return this;
  }

  async verifyLogin(username: string, password: string): Promise<User | undefined> {
    const row = await this.#db.collection('users').findOne({ username });

    const entity = await Promise.resolve(row)
      .then(UserCredential.safeParse)
      .catch(() => undefined)
      ?? undefined;

    if (entity?.success && await argon2.verify(entity.data.password, password)) {
      const { password: ignored, _id, ...user }  = entity.data;
      return {
        ...user,
        _id
      };
    }
  }
}
