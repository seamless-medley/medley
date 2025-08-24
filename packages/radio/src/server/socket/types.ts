import EventEmitter from "node:events";
import type TypedEventEmitter from "typed-emitter";
import type { Request } from 'express';
import { Socket as IOSocket } from "socket.io";
import type { ClientEvents, ServerEvents, PickEvent } from "@seamless-medley/remote";
import { UserModel } from "../../db/models/user";
import type { RTCWorker } from "../audio/rtc/transponder";

export type TypedEventEmitterOf<T> = TypedEventEmitter<
  // @ts-ignore
  PickEvent<T>
>;

export function MixinEventEmitterOf<T>() {
  return EventEmitter as unknown as new (...args: any[]) => TypedEventEmitterOf<T>;
}

export type ClientSocketData = {
  user?: UserModel;
  lastPing?: number;
  latencyBacklog: number[];
  rtcWorker?: RTCWorker;
}

export type Socket = IOSocket<ClientEvents, ServerEvents, never, ClientSocketData>;

/**
 * Return `true` if allowed
 */
export type GuardPredicate = (socket: Socket, instance: object) => boolean | Promise<boolean>;

export const getSocketSession = (socket: Socket) => (socket.request as Request).session;
