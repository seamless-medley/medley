import * as core from './core';
import * as rtc from "./rtc";

export * from './core';
export * from './rtc';


export interface RemoteTypes {
  global: core.Global;
  station: core.Station;
  deck: core.Deck;
  collection: core.Collection;
  //
  transponder: rtc.RTCTransponder;
}
