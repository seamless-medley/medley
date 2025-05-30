import { MixinEventEmitterOf } from "../../socket";
import { Global as RemoteGlobal } from '../../../remotes';
import { $Exposing, $Kind, Exposable } from "../../../socket";
import { MedleyServer } from "../../medley-server";

export class ExposedGlobal extends MixinEventEmitterOf<RemoteGlobal>() implements Exposable<RemoteGlobal> {
  [$Exposing] = undefined;
  [$Kind] = 'global';

  #medley: MedleyServer;

  constructor(medley: MedleyServer) {
    super();

    this.#medley = medley;
  }

  dispose(): void {

  }

  getStations() {
    return Array.from(this.#medley.stations.keys());
  }

  get instanceName() {
    return this.#medley.instanceName;
  }
}
