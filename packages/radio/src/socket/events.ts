export type ServerEvents = {
  'remote:event': (ns: string, id: string, event: string, ...args: any[]) => void;
  'remote:update': (ns: string, id: string, prop: string, oldValue: any, newValue: any) => void;
}

type OKResponse<T> = {
  status: undefined;
  result: T;
}

type ErrorResponse<T extends string> = {
  status: T;
}

type ExceptionResponse = {
  status: 'exception';
  message: string;
}

export type RemoteResponse<T> =
  OKResponse<T> |
  ErrorResponse<'key'> |
  ErrorResponse<'id'> |
  ExceptionResponse;

export type ResponseStatus = RemoteResponse<any>['status'];

export type RemoteErrorStatus = Exclude<ResponseStatus, undefined>;

export type RemoteCallback<T = any> = (response: RemoteResponse<T>) => Promise<void>


export type ClientEvents = {
  // property
  'remote:get': (ns: string, id: string, prop: string, callback: RemoteCallback) => void;
  'remote:set': (ns: string, id: string, prop: string, value: any, callback: RemoteCallback) => void;
  // method
  'remote:invoke': (ns: string, id: string, method: string, args: any[], callback: RemoteCallback) => void;
  // object event
  'remote:subscribe': (ns: string, id: string, event: string, callback: RemoteCallback) => void;
  'remote:unsubscribe': (ns: string, id: string, event: string, callback: RemoteCallback) => void;
  // observ
  'remote:observe': (ns: string, id: string, callback: RemoteCallback<{ [prop: string]: any }>) => void;
  'remote:unobserve': (ns: string, id: string, callback: RemoteCallback) => void;
}
