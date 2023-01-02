import { Options as MongoDBOptions } from "../../musicdb/mongo";
import { $Exposing, Exposable } from "../../socket/expose";
import { Config } from "../../socket/remote";
import { PickProp } from "../../socket/types";

export type ExposedConfigCallback = {
  onMongoDB(): Promise<void>;
}

export class ExposedConfig implements Exposable<Config> {
  [$Exposing] = true as const;

  private _mongodb: MongoDBOptions;

  #handler: ExposedConfigCallback;

  constructor(config: PickProp<Config>, handler: ExposedConfigCallback) {
    this.#handler = handler;
    this._mongodb = config.mongodb;
  }

  get mongodb() {
    return this._mongodb;
  }

  async asyncSetMongodb(value: MongoDBOptions) {
    this._mongodb = value;
    return this.#handler.onMongoDB();
  }
};
