import { Station } from "./core/station";
import { Deck } from "./core/deck";
import { Collection } from "./core/collection";
import { RTCTransponder } from "./rtc/transponder";

export interface RemoteTypes {
  station: Station;
  deck: Deck;
  collection: Collection;
  //
  transponder: RTCTransponder;
}

