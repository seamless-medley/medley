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

type TypedEventsMapOf<T, Events = PickEvent<T>> = {
  [E in keyof Events]: [EventNameOf<E>, Events[E]];
}[keyof Events];

export type TypedEventsOf<T, Mapping extends TypedEventsMapOf<T> = TypedEventsMapOf<T>> = {
  [K in Extract<Mapping[0], string>]: Mapping[1];
}

export type TypedEventEmitterOf<T> = TypedEventEmitter<TypedEventsOf<T>>;

export function MixinEventEmitterOf<T>() {
  return EventEmitter as unknown as new () => TypedEventEmitterOf<T>;
}

export type Exposable<T> = EventEmitterOf<T> & WithoutEvents<T>;

type GettersOf<T> = {
  [K in keyof T]: () => Promise<T[K]>;
}

type SettersOf<T> = {
  [K in keyof T]: (newValue: T[K]) => Promise<T[K]>;
}

type AsyncFunctionsOf<T> = {
  [K in keyof T]: AsyncFunctionOf<T[K]>;
}

export type Remotable<T, Props = PickProp<T>> = EventEmitterOf<T> & GettersOf<PickProp<T>> & SettersOf<PickProp<T>> & AsyncFunctionsOf<PickMethod<T>> & {
  onPropertyChange<P extends keyof Props>(prop: P, listener: (oldValue: Props[P], newValue: Props[P]) => any): ThisType<T>;
  onDispose(listener: () => Promise<any>): ThisType<T>;
};
