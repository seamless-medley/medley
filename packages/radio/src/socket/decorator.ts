import "reflect-metadata";

const remoteTimeoutKey = Symbol("$RemoteTimeout");

export const RemoteTimeout = (n: number = 60_000) => (target: any, prop?: string) => {
  if (prop) {
    Reflect.defineMetadata(remoteTimeoutKey, n, target.constructor, prop);
  } else {
    Reflect.defineMetadata(remoteTimeoutKey, n, target);
  }
}

export function getRemoteTimeout(target: any, prop: string) {
  const result = prop ? Reflect.getMetadata(remoteTimeoutKey, target, prop) : undefined;
  return result ?? Reflect.getMetadata(remoteTimeoutKey, target);
}
