import type * as core from './core';
import type * as rtc from "./rtc";

export * from './core';
export * from './rtc';

export interface RemoteObjects {
  global: core.Global;
  station: core.Station;
  deck: core.Deck;
  collection: core.Collection;
  collection_view: core.CollectionView;
  //
  transponder: rtc.RTCTransponder;
}
