import workerpool, { Pool as WorkerPool, WorkerPoolOptions } from "workerpool";
import { createLogger } from "@seamless-medley/logging";

export abstract class WorkerPoolAdapter<Methods extends { [name: string]: any }> {
  protected logger = createLogger({
    name: this.constructor.name
  })

  protected pool!: WorkerPool;

  constructor(script: string, options: WorkerPoolOptions) {
    this.pool = this.#patchPool(workerpool.pool(script, options));
  }

  protected exec<M extends keyof Methods>(m: M, ...args: Parameters<Methods[M]>) {
    return this.pool.exec<Methods[M]>(m as string, args);
  }

  #patchSend(handler: any) {
    const worker = handler.worker;

    if (!worker.patched) {
      worker.send = (message: any) => {
        try {
          worker.postMessage(message);
        }
        catch (e: any) {
          this.logger.error(e, 'Error posting');
        }
      }

      worker.patched = true;
    }
  }

  #patchPool(pool: WorkerPool) {
    const p = pool as any;
    p._next = () => {
      if (p.tasks.length > 0) {
        const worker = p._getWorker();

        if (worker) {
          const task = p.tasks.shift();

          if (!task.resolver.promise.pending) {
            p._next();
            return;
          }

          this.#patchSend(worker);

          const promise = worker.exec(task.method, task.params, task.resolver, task.options)
            .then(p._boundNext)
            .catch(() => {
              if (worker.terminated) {
                return p._removeWorker(worker);
              }
            })
            .then(() => {
              p._next();
            });

          if (typeof task.timeout === 'number') {
            promise.timeout(task.timeout);
          }
        }
      }
    }

    return pool;
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
