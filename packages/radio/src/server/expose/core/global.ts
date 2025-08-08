import type { Global as RemoteGlobal, Exposable } from "@seamless-medley/remote";
import { MixinEventEmitterOf } from "../../socket";
import { MedleyServer } from "../../medley-server";

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
