import EventEmitter from "events";
import type TypedEventEmitter from "typed-emitter";
import { Socket as IOSocket } from "socket.io";
import { ClientEvents, ServerEvents, PickEvent } from "../../socket";

export type TypedEventEmitterOf<T> = TypedEventEmitter<
  // @ts-ignore
  PickEvent<T>
>;

export function MixinEventEmitterOf<T>() {
  return EventEmitter as unknown as new (...args: any[]) => TypedEventEmitterOf<T>;
}

export type ClientData = {
  auth: boolean;
}

export type Socket = IOSocket<ClientEvents, ServerEvents, never, ClientData>;

export type GuardPredicate = (socket: Socket, instance: object) => boolean | Promise<boolean>;
