import { Config } from "./config";
import { Station } from "./station";
import { Deck } from "./deck";
import { Collection } from "./collection";

export type {
  Config,
  Station,
  Deck,
  Collection
}

export interface RemoteTypes {
  config: Config;
  station: Station;
  deck: Deck;
  collection: Collection;
}

