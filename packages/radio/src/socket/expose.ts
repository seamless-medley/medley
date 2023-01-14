import { PickProp, WithoutEvents } from "./types";

export const $Exposing: unique symbol = Symbol('$Exposing');

type AsyncSetOfName<T> = `asyncSet${Capitalize<Extract<T, string>>}`;

export type Exposable<T, Props = PickProp<T>> =
  WithoutEvents<T> &
  {
    [K in keyof Props as AsyncSetOfName<K>]?: (value: Props[K]) => Promise<void>;
  };
