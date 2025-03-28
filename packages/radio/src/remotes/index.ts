import { Global } from './core/global';
import { Station } from "./core/station";
import { Deck } from "./core/deck";
import { Collection } from "./core/collection";
import { RTCTransponder } from "./rtc/transponder";

export interface RemoteTypes {
  global: Global;
  station: Station;
  deck: Deck;
  collection: Collection;
  //
  transponder: RTCTransponder;
}

