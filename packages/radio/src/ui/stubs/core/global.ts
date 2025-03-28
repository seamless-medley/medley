import { StubOf } from "../../../socket";
import { Global as RemoteGlobal } from '../../../remotes/core/global';
import { noop } from "lodash";

class StubbingGlobal {
  getStations = noop as any;
}

export const StubGlobal = StubOf<RemoteGlobal>(StubbingGlobal);
