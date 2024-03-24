import type { ObservedPropertyChange, SessionData } from "./types";

export type ServerEvents = {
  // Server Ping
  's:p': (timestamp: number, callback: (timestamp: number) => void) => void;
  // Client Latency, latency between server and client
  'c:l': (latencyMs: number) => void;
  // Client session
  'c:s': (session: SessionData) => void;
  // Remote Event, when a remote object emit an event
  'r:e': (kind: string, id: string, event: string, ...args: any[]) => void;
  // Remote Update, when a remote object has changed its properties
  'r:u': (kind: string, id: string, changes: ObservedPropertyChange[]) => void;
  // Remote Stream Data
  'r:sd': (id: number, data: Buffer) => void;
  // Remote Stream Closed
  'r:sc': (id: number) => void;
}


export type OKResponse<T> = {
  status: undefined;
  result: T;
}

export type StreamResponse = {
  status: 'stream';
  result: [number, number];
}

export type ProhibitedErrorResponse = {
  status: 'prohibited';
  id: string;
  key?: string;
}

export type IdErrorResponse = {
  status: 'id';
  id: string;
}

export type KeyErrorResponse = {
  status: 'key';
  key: string;
}

export type ExceptionResponse = {
  status: 'exception';
  message: string;
}

export type ErrorResponse = IdErrorResponse | KeyErrorResponse | ProhibitedErrorResponse | ExceptionResponse;;

export type RemoteResponse<T> = OKResponse<T> | StreamResponse | ErrorResponse;

export type ResponseStatus = RemoteResponse<any>['status'];

export type RemoteErrorStatus = Exclude<ResponseStatus, undefined>;

export type RemoteCallback<T = any> = (response: RemoteResponse<T>) => Promise<void>;

export type RemoteCallParams<T> = T extends (...args: [...infer P, infer H]) => any ? { params: P, handler: H } : never;

export type RemoteObserveOptions = {
  ignoreOldValue?: boolean;
}

export type ClientEvents = {
  'c:a': (x: number[], username: number[], password: number[]) => void;
  // property
  'r:pg': (kind: string, id: string, prop: string, callback: RemoteCallback) => void;
  'r:ps': (kind: string, id: string, prop: string, value: any, callback: RemoteCallback) => void;
  // method
  'r:mi': (kind: string, id: string, method: string, args: any[], callback: RemoteCallback) => void;
  // object event
  'r:es': (kind: string, id: string, event: string, callback: RemoteCallback) => void;
  'r:eu': (kind: string, id: string, event: string, callback: RemoteCallback) => void;
  // observ
  'r:ob': (kind: string, id: string, options: RemoteObserveOptions | undefined, callback: RemoteCallback<{ [prop: string]: any }>) => void;
  'r:ub': (kind: string, id: string, callback: RemoteCallback) => void;
}
