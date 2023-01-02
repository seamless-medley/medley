import { Options as MongoDBOptions } from "../../musicdb/mongo";

export interface Config {
  mongodb: MongoDBOptions;
}
