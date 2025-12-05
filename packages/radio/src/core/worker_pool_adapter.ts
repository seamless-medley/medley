import workerpool, { Pool as WorkerPool, WorkerPoolOptions } from "workerpool";
import { createLogger } from "../logging";

export abstract class WorkerPoolAdapter<Methods extends { [name: string]: any }> {
  protected logger = createLogger({
    name: this.constructor.name
  })

  protected pool!: WorkerPool;

  constructor(script: string, options: WorkerPoolOptions) {
    const { workerThreadOpts = {}, ...restOptions } = options;

    this.pool = workerpool.pool(script, {
      ...restOptions,
      workerThreadOpts
    });
  }

  protected exec<M extends keyof Methods>(m: M, ...args: Parameters<Methods[M]>) {
    return this.pool.exec<Methods[M]>(m as string, args);
  }

  protected preSpawn(n: number = workerpool.cpus) {
    const pool = (this.pool as any);
    const workers = pool.workers as any[];

    for (let i = 0; i < n; i++) {
      const worker = pool._createWorkerHandler();
      workers.push(worker);
    }
  }
}
