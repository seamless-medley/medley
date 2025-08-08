import { noop } from "lodash";
import { StubOf } from "../stub";
import type { Global as RemoteGlobal } from '@seamless-medley/remote';

class StubbingGlobal {
  getStations = noop as any;
  instanceName = undefined as any;
}

export const StubGlobal = StubOf<RemoteGlobal>(StubbingGlobal);
