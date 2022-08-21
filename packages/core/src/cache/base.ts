import { random } from "lodash";
import { WorkerPoolAdapter } from "../worker_pool_adapter";
import { CacheOptions } from "./types";

/** @deprecated */
export abstract class BaseCache<Methods> extends WorkerPoolAdapter<Methods> {
  constructor() {
    super(__dirname + '/worker.js', {});

    this.preSpawn();
  }

  protected ttls: [min: number, max: number] = [
    60 * 60 * 24 * 1000,
    60 * 60 * 36 * 1000
  ];

  async init(options: CacheOptions) {
    if (options.ttls) {
      this.ttls = options.ttls;
    }

    const pool = (this.pool as any);
    for (const worker of pool.workers as any[]) {
      await worker.exec('configure', [{
        ...options,
        ttl: this.ttls[0]
      }]);
    }
  }

  protected makeTTL() {
    return random(this.ttls[0], this.ttls[1]);
  }
}
