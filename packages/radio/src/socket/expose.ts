import { PickProp, WithoutEvents } from "./types";

export const $Exposing: unique symbol = Symbol('$Exposing');
export const $Kind: unique symbol = Symbol('$Kind');

type AsyncSetOfName<T> = `asyncSet${Capitalize<Extract<T, string>>}`;

export type Exposable<T, Props = PickProp<T>> =
  WithoutEvents<T> &
  {
    [$Exposing]: any;
    [$Kind]: string;
    dispose(): void;
  } &
  {
    [K in keyof Props as AsyncSetOfName<K>]?: (value: Props[K]) => Promise<void>;
  };
