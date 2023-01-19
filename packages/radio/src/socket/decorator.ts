import "reflect-metadata";
import type { PickProp } from "./types";

const $RemoteTimeout = Symbol("$RemoteTimeout");

export const RemoteTimeout = (n: number = 60_000) => (target: any, prop?: string) => {
  if (prop) {
    Reflect.defineMetadata($RemoteTimeout, n, target.constructor, prop);
  } else {
    Reflect.defineMetadata($RemoteTimeout, n, target);
  }
}

export function getRemoteTimeout(target: any, prop: string) {
  const result = prop ? Reflect.getMetadata($RemoteTimeout, target, prop) : undefined;
  return result ?? Reflect.getMetadata($RemoteTimeout, target);
}

const $Dependents = Symbol("$Dependents");

export function DependsOn<T extends object>(...names: (keyof PickProp<T>)[]): (target: object, propertyKey: string | symbol) => void {
  return (target, prop) => {
    for (const name of names) {
      const existing = Reflect.getMetadata($Dependents, target.constructor, name as any) ?? [];
      Reflect.defineMetadata($Dependents, Array.from(new Set([...existing, prop])), target.constructor, name as any);
    }
  }
}

export function getDependents(target: any, prop: string): string[] {
  return Reflect.getMetadata($Dependents, target.constructor, prop) ?? [];
}
