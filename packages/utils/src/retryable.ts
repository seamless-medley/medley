import { delayed } from "./wait";

export type RetryInfo = {
  attempts: number;
  previousError: unknown;
}

export type RetryOptions = {
  retries?: number;
  signal?: AbortSignal;
  onError?: (err: any, attempts: number) => any;
  wait: number;
  /**
   * @default 1.01
   */
  factor?: number;
  maxWait?: number;
}

export class AbortRetryError extends Error {

}

export function retryable<R>(fn: (info: RetryInfo) => Promise<R>, options: RetryOptions) {
  let attempts = 0;
  let previousError: unknown;

  async function wrapper(n?: number): Promise<R | undefined> {
    try {
      if (options.signal?.aborted) {
        return;
      }

      return await fn({ attempts, previousError });
    } catch (e) {
      if (e instanceof AbortRetryError) {
        return;
      }

      if (n !== undefined && n <= 0) {
        throw e;
      }

      previousError = e;
      ++attempts;

      options?.onError?.(e, attempts);

      const wait = Math.min(
        options.maxWait ?? options.wait,
        options.wait * Math.pow(options.factor ?? 1.01, attempts)
      );

      return delayed(() => wrapper(n !== undefined ? n - 1 : n), wait)();
    }
  }

  return new Promise<R | undefined>((resolve, reject) => {
    wrapper(options.retries).then(resolve).catch(reject)
  });
}
