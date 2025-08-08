import type { PickProp, WithoutEvents } from "./types";

type AsyncSetOfName<T> = `asyncSet${Capitalize<Extract<T, string>>}`;

export type Exposable<T, Props = PickProp<T>> =
  WithoutEvents<T> &
  {
    $Exposing: any;
    $Kind: string;
    dispose(): void;
  } &
  {
    [K in keyof Props as AsyncSetOfName<K>]?: (value: Props[K]) => Promise<void>;
  };
