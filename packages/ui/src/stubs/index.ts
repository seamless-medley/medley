import { Stub } from "./stub";
import { StubCollection, StubCollectionView } from "./core/collection";
import { StubDeck } from "./core/deck";
import { StubGlobal } from "./core/global";
import { StubStation } from "./core/station";
import { StubRTCTransponder } from "./rtc/transponder";

export * from './stub';

export const Stubs: Record<string, Stub<unknown>> = {
  global: StubGlobal,
  station: StubStation,
  deck: StubDeck,
  collection: StubCollection,
  collection_view: StubCollectionView,
  transponder: StubRTCTransponder
}
