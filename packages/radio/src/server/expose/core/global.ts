import { MixinEventEmitterOf } from "../../socket";
import { Global as RemoteGlobal } from '../../../remotes';
import { Exposable } from "../../../socket";
import { MedleyServer } from "../../medley-server";


export class ExposedGlobal extends MixinEventEmitterOf<RemoteGlobal>() implements Exposable<RemoteGlobal> {
  #medley: MedleyServer;

  constructor(medley: MedleyServer) {
    super();

    this.#medley = medley;
  }

  getStations() {
    return Array.from(this.#medley.stations.keys());
  }

  get instanceName() {
    return this.#medley.instanceName;
  }
}
