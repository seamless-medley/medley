import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import { PickEvent } from "../../socket";

export type TypedEventEmitterOf<T> = TypedEventEmitter<
  // @ts-ignore
  PickEvent<T>
>;

export function MixinEventEmitterOf<T>() {
  return EventEmitter as unknown as new (...args: any[]) => TypedEventEmitterOf<T>;
}
