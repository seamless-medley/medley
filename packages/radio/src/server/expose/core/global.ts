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

  getStations(): string[] {
    return Array.from(this.#medley.stations.keys());
  }

  getInstanceName(): string {
    return this.#medley.instanceName
  }
}
