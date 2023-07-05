import workerpool, { WorkerPool, WorkerPoolOptions } from "workerpool";
import { createLogger } from "./logging";

export abstract class WorkerPoolAdapter<Methods extends { [name: string]: any }> {
  protected logger = createLogger({
    name: this.constructor.name
  })

  protected pool!: WorkerPool;

  constructor(script: string, options: WorkerPoolOptions) {
    this.pool = this.patchPool(workerpool.pool(script, options));
  }

  protected exec<M extends keyof Methods>(m: M, ...args: Parameters<Methods[M]>) {
    return this.pool.exec<Methods[M]>(m as string, args);
  }

  private patchSend(handler: any) {
    const worker = handler.worker;

    if (!worker.patched) {
      worker.send = (message: any) => {
        try {
          worker.postMessage(message);
        }
        catch (e: any) {
          this.logger.error('Error posting', e);
        }
      }

      worker.patched = true;
    }
  }

  private patchPool(pool: WorkerPool) {
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

          this.patchSend(worker);

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

  protected preSpawn() {
    const pool = (this.pool as any);
    const workers = pool.workers as any[];

    for (let i = 0; i < workerpool.cpus; i++) {
      const worker = pool._createWorkerHandler();
      workers.push(worker);
    }
  }
}
