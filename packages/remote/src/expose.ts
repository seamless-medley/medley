import type { PickProp, WithoutEvents } from "./type-utils";

type AsyncSetOfName<T> = `asyncSet${Capitalize<Extract<T, string>>}`;

export type Notify<T> = <Props extends PickProp<T>, P extends keyof Props>(prop: P, value: Props[P]) => any;

export type Exposable<T, Props = PickProp<T>> =
  WithoutEvents<T> &
  {
    $Exposing: any;
    $Kind: string;
    notify: Notify<T>;
    dispose(): void;
  } &
  {
    [K in keyof Props as AsyncSetOfName<K>]?: (value: Props[K]) => Promise<void>;
  };
