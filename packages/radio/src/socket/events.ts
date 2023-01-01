export type ServerEvents = {
  'remote:event': (kind: string, id: string, event: string, ...args: any[]) => void;
  'remote:update': (kind: string, id: string, prop: string, oldValue: any, newValue: any) => void;
}

export type OKResponse<T> = {
  status: undefined;
  result: T;
}

export type IdOrKeyErrorResponse = {
  status: 'id' | 'key';
}

export type ExceptionResponse = {
  status: 'exception';
  message: string;
}

export type ErrorResponse = IdOrKeyErrorResponse | ExceptionResponse;;

export type RemoteResponse<T> = OKResponse<T> | ErrorResponse;

export type ResponseStatus = RemoteResponse<any>['status'];

export type RemoteErrorStatus = Exclude<ResponseStatus, undefined>;

export type RemoteCallback<T = any> = (response: RemoteResponse<T>) => Promise<void>


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
