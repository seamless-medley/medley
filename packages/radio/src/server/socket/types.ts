import EventEmitter from "node:events";
import type TypedEventEmitter from "typed-emitter";
import { Socket as IOSocket } from "socket.io";
import { ClientEvents, ServerEvents, PickEvent } from "../../socket";
import { UserModel } from "../../db/models/user";

export type TypedEventEmitterOf<T> = TypedEventEmitter<
  // @ts-ignore
  PickEvent<T>
>;

export function MixinEventEmitterOf<T>() {
  return EventEmitter as unknown as new (...args: any[]) => TypedEventEmitterOf<T>;
}

export type ClientData = {
  user?: UserModel;
}

export type Socket = IOSocket<ClientEvents, ServerEvents, never, ClientData>;

/**
 * Return `true` if allowed
 */
export type GuardPredicate = (socket: Socket, instance: object) => boolean | Promise<boolean>;
