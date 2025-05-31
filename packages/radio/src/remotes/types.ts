import type { ConditionalExcept } from "type-fest";

type SelectKeyBy<O, C> = { [Key in keyof O]: Key extends C ? Key : never}[keyof O];
type SelectKeyByValue<O, C> = { [Key in keyof O]: O[Key] extends C ? Key : never}[keyof O];
type EventNameOf<T> = T extends `ϟ${infer Name}` ? Name : never;

export type WithoutEvents<T> = Omit<T, SelectKeyBy<T, `ϟ${string}`>>;

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

type AsyncFunctionOf<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;

type AsyncFunctionsOf<T> = {
  [K in keyof T]: AsyncFunctionOf<T[K]>;
}

export type Remotable<T, Props = PickProp<T>> =
  EventEmitterOf<T> &
  GettersOf<Props> &
  SettersOf<Props> &
  AsyncFunctionsOf<PickMethod<T>> &
{
  /**
   * Get a fresh propery value
   */
  getProperty<P extends keyof Props>(prop: P): Promise<Props[P]>;

  /**
   * Get all cached properties
   */
  getProperties(): Props;

  /**
   * Add a listener for listening to changes
   *
   * Call the returned function to stop listening
   */
  addPropertyChangeListener<P extends keyof Props>(props: P | symbol, listener: (newValue: Props[P], oldValue: Props[P], prop: P) => any): () => void;

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

export type AuthData = {
  nn: number[];
  up: [number[], number[]];
}

export type PlainUser = {
  username: string;
  flags: string;
}

export type SessionData = {
  user?: PlainUser;
}
