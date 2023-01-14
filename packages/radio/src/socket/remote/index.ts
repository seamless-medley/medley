import { Collection } from "./collection";
import { Config } from "./config";
import { Station } from "./station";

export type {
  Config,
  Station,
  Collection
}

export interface RemoteTypes {
  config: Config;
  station: Station;
  collection: Collection;
}

