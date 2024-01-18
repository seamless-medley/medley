
import type { ConditionalExcept } from "type-fest";
import type { AsyncFunctionOf } from "../types";

export type SelectKeyBy<O, C> = { [Key in keyof O]: Key extends C ? Key : never}[keyof O];
export type SelectKeyByValue<O, C> = { [Key in keyof O]: O[Key] extends C ? Key : never}[keyof O];
export type WithoutEvents<T> = Omit<T, SelectKeyBy<T, `ϟ${string}`>>;
export type EventNameOf<T> = T extends `ϟ${infer Name}` ? Name : never;

export type PickEvent<T> = {
  [K in keyof T as EventNameOf<K>]: T[K];
}

export type PickMethod<T> = Pick<T, SelectKeyByValue<WithoutEvents<T>, Function>>;
export type PickProp<T> = ConditionalExcept<T, Function>;

export type EventEmitterOf<T, Events = PickEvent<T>> = keyof Events extends never ? {} : {
  on<E extends keyof Events>(event: E, listener: Events[E]): ThisType<T>;
  off<E extends keyof Events>(event: E, listener: Events[E]): ThisType<T>;
}

type GettersOf<T> = {
  [K in keyof T]: () => T[K];
}

type SettersOf<T> = {
  [K in keyof T]: (newValue: T[K]) => Promise<T[K]>;
}

type AsyncFunctionsOf<T> = {
  [K in keyof T]: AsyncFunctionOf<T[K]>;
}

export const $AnyProp: unique symbol = Symbol('$AnyProp');
export type AnyProp = typeof $AnyProp;

export type Remotable<T, Props = PickProp<T>> =
  EventEmitterOf<T> &
  GettersOf<Props> &
  SettersOf<Props> &
  AsyncFunctionsOf<PickMethod<T>> &
{
  getProperties(): Props;
  //
  addPropertyChangeListener<P extends keyof Props>(props: P | AnyProp, listener: (newValue: Props[P], oldValue: Props[P], prop: P) => any): () => void;
  addDisposeListener(listener: () => Promise<any>): ThisType<T>;
  //
  dispose(): Promise<void>;
};

export type ObservedPropertyChange<T = any> = {
  p: string;
  o?: T;
  n: T;
}

export type ObservedPropertyHandler<T> = (instance: T, changes: ObservedPropertyChange[]) => Promise<any>;

export type ExtractCtor<T> = T extends new (...args: infer A) => infer R ? { args: A, returns: R } : never;
