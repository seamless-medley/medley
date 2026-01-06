import type { Global as RemoteGlobal, Exposable, Notify } from "@seamless-medley/remote";
import { MixinEventEmitterOf } from "../../socket";
import { MedleyServer } from "../../medley-server";

export class ExposedGlobal extends MixinEventEmitterOf<RemoteGlobal>() implements Exposable<RemoteGlobal> {
  $Exposing = undefined;
  $Kind = 'global';
  notify!: Notify<RemoteGlobal>;

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
}
