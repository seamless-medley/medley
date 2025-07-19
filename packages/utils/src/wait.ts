export const waitFor = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const handleAbort = () => {
    clearTimeout(timer);
    reject(new Error('Aborted'));
  }

  signal?.addEventListener('abort', handleAbort);

  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, ms);
});

export const delayed = <T extends () => any, R = ReturnType<T>>(fn: T, wait: number): () => Promise<Awaited<R>> => () => waitFor(wait).then(fn);

export const breath = () => waitFor(0);

export const nextTick = () => new Promise<void>(resolve => process.nextTick(resolve));
