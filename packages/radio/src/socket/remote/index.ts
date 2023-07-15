import { Collection } from "./collection";
import { Config } from "./config";
import { Station } from "./station";
import { Deck } from "./deck";

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

