import { MixinEventEmitterOf } from "../../socket";
import { Global as RemoteGlobal } from '../../../remotes/objects';
import { MedleyServer } from "../../medley-server";
import { Exposable } from "../../../remotes/expose";

export class ExposedGlobal extends MixinEventEmitterOf<RemoteGlobal>() implements Exposable<RemoteGlobal> {
  $Exposing = undefined;
  $Kind = 'global';

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
