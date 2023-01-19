import type { ObservedPropertyChange } from "./types";

export type ServerEvents = {
  'remote:event': (kind: string, id: string, event: string, ...args: any[]) => void;
  'remote:update': (kind: string, id: string, changes: ObservedPropertyChange[]) => void;
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

export type ClientEvents = {
  // property
  'remote:get': (kind: string, id: string, prop: string, callback: RemoteCallback) => void;
  'remote:set': (kind: string, id: string, prop: string, value: any, callback: RemoteCallback) => void;
  // method
  'remote:invoke': (kind: string, id: string, method: string, args: any[], callback: RemoteCallback) => void;
  // object event
  'remote:subscribe': (kind: string, id: string, event: string, callback: RemoteCallback) => void;
  'remote:unsubscribe': (kind: string, id: string, event: string, callback: RemoteCallback) => void;
  // observ
  'remote:observe': (kind: string, id: string, callback: RemoteCallback<{ [prop: string]: any }>) => void;
  'remote:unobserve': (kind: string, id: string, callback: RemoteCallback) => void;
}
