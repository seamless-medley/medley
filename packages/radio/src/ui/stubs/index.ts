import { Stub } from "../../socket";
import { StubCollection } from "./core/collection";
import { StubDeck } from "./core/deck";
import { StubGlobal } from "./core/global";
import { StubStation } from "./core/station";
import { StubRTCTransponder } from "./rtc/transponder";

export const Stubs: Record<string, Stub<unknown>> = {
  global: StubGlobal,
  station: StubStation,
  deck: StubDeck,
  collection: StubCollection,
  transponder: StubRTCTransponder
}
