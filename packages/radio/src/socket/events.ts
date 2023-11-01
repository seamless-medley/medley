import type { ObservedPropertyChange } from "./types";

export type ServerEvents = {
  'r:e': (kind: string, id: string, event: string, ...args: any[]) => void;
  'r:u': (kind: string, id: string, changes: ObservedPropertyChange[]) => void;
  // TODO: new server event for sending streaming data
}

export type OKResponse<T> = {
  status: undefined;
  result: T;
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

export type ErrorResponse = IdErrorResponse | KeyErrorResponse | ExceptionResponse;;

export type RemoteResponse<T> = OKResponse<T> | ErrorResponse;

export type ResponseStatus = RemoteResponse<any>['status'];

export type RemoteErrorStatus = Exclude<ResponseStatus, undefined>;

export type RemoteCallback<T = any> = (response: RemoteResponse<T>) => Promise<void>;

export type RemoteCallParams<T> = T extends (...args: [...infer P, infer H]) => any ? { params: P, handler: H } : never;

export type RemoteObserveOptions = {
  ignoreOldValue?: boolean;
}

export type ClientEvents = {
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
