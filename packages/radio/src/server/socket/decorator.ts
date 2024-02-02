import "reflect-metadata";
import type { PickProp } from "../../socket/types";
import { GuardPredicate, Socket } from "./types";
import { loggedIn } from "./guards";

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

const $Guard = Symbol("$Guard");

export const Guarded = (predicate: GuardPredicate) => (target: any, prop?: string) => {
  if (prop) {
    Reflect.defineMetadata($Guard, predicate, target.constructor, prop);
  } else {
    Reflect.defineMetadata($Guard, predicate, target);
  }
}

export function getGuardingPredicate(target: any, prop?: string): GuardPredicate | undefined {
  const result = prop ? Reflect.getMetadata($Guard, target, prop) : undefined;
  return result ?? Reflect.getMetadata($Guard, target);
}

export async function hasObjectGuardAccess(socket: Socket, instance: object, prop?: string): Promise<boolean> {
  const pred = getGuardingPredicate(instance.constructor, prop);

  if (!pred) {
    return true;
  }

  return pred(socket, instance);
}

export const LoggedIn = Guarded(loggedIn);

