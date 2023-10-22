import { Station } from "./core/station";
import { Deck } from "./core/deck";
import { Collection } from "./core/collection";

export type {
  Station,
  Deck,
  Collection
}

export interface RemoteTypes {
  station: Station;
  deck: Deck;
  collection: Collection;
}

