import {RadioInfo} from "../../../remotes/core/info";
import {$Exposing, Exposable} from "../../../socket";
import {MixinEventEmitterOf} from "../../socket";

export class ExposedRadio extends MixinEventEmitterOf<RadioInfo>() implements Exposable<RadioInfo> {
  [$Exposing]: RadioInfo

  constructor() {
    super();
    this[$Exposing] = { stationsIds: [] };
  }

  addStation(stationId: string) {
    this[$Exposing].stationsIds.push(stationId);
  }

  get stationsIds() {
    return this[$Exposing].stationsIds;
  }
}
