import EventEmitter from "events";
import type { ConditionalExcept } from "type-fest";
import TypedEventEmitter from "typed-emitter";
import { AsyncFunctionOf } from "../types";

export type SelectKeyBy<O, C> = { [Key in keyof O]: Key extends C ? Key : never}[keyof O];
export type SelectKeyByValue<O, C> = { [Key in keyof O]: O[Key] extends C ? Key : never}[keyof O];
export type WithoutEvents<T> = Omit<T, SelectKeyBy<T, `ϟ${string}`>>;
export type EventNameOf<T> = T extends `ϟ${infer Name}` ? Name : never;

export type PickEvent<T> = Pick<T, SelectKeyBy<T, `ϟ${string}`>>;
export type PickMethod<T> = Pick<T, Exclude<SelectKeyByValue<T, Function>, keyof PickEvent<T>>>;
export type PickProp<T> = ConditionalExcept<T, Function>;

export type EventEmitterOf<T, Events = PickEvent<T>> = keyof Events extends never ? {} : {
  on<E extends keyof Events>(event: EventNameOf<E>, listener: Events[E]): ThisType<T>;
  off<E extends keyof Events>(event: EventNameOf<E>, listener: Events[E]): ThisType<T>;
}

export type TypedEventsOf<T, Events = PickEvent<T>> = {
  [K in keyof Events as EventNameOf<K>]: Events[K];
}

// @ts-ignore
export type TypedEventEmitterOf<T> = TypedEventEmitter<TypedEventsOf<T>>;

export function MixinEventEmitterOf<T>() {
  return EventEmitter as unknown as new () => TypedEventEmitterOf<T>;
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

export const $AnyProp: unique symbol = Symbol.for('$AnyProp');
export type AnyProp = typeof $AnyProp;

export type Remotable<T, Props = PickProp<T>> = EventEmitterOf<T> & GettersOf<Props> & SettersOf<Props> & AsyncFunctionsOf<PickMethod<T>> & {
  getProperties(): Props;
  //
  onPropertyChange<P extends keyof Props>(props: P | AnyProp, listener: (oldValue: Props[P], newValue: Props[P]) => any): () => void;
  onDispose(listener: () => Promise<any>): ThisType<T>;
  //
  dispose(): Promise<void>;
};

export type ObservedPropertyHandler<T> = (instance: T, prop: string, oldValue: any, newValue: any) => Promise<any>;

export type ExtractCtor<T> = T extends new (...args: infer A) => infer R ? { args: A, returns: R } : never;
