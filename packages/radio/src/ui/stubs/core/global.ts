import { noop } from "lodash";
import { StubOf } from "../../../socket";
import { Global as RemoteGlobal } from '../../../remotes';

class StubbingGlobal {
  getStations = noop as any;
  getInstanceName = noop as any;
}

export const StubGlobal = StubOf<RemoteGlobal>(StubbingGlobal);
