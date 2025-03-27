import {StubOf} from "../../../socket";
import {RadioInfo} from "../../../remotes/core/info";

class StubbingRadioInfo {
  stationsIds = [];
}

export const StubRadioInfo = StubOf<RadioInfo>(StubbingRadioInfo)
