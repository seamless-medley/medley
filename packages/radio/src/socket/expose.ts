import { PickProp, WithoutEvents } from "./types";

export const $Exposing: unique symbol = Symbol.for('$Exposing');

export type Exposing = {
  [$Exposing]: true;
}

type AsyncSetOfName<T> = `asyncSet${Capitalize<Extract<T, string>>}`;

export type Exposable<T, Props = PickProp<T>> =
  WithoutEvents<T> &
  Exposing & {
    [K in keyof Props as AsyncSetOfName<K>]?: (value: Props[K]) => Promise<void>;
  };
