export type ServerEvents = {
  'remote:event': (ns: string, id: string, event: string, ...args: any[]) => void;
}

export type RemoteResponse<T> = {
  status: 'ok';
  result: T;
} | {
  status: 'error';
  reason: string;
}

export type RemoteCallback<T = any> = (response: RemoteResponse<T>) => Promise<void>

export type ClientEvents = {
  'remote:get': (ns: string, id: string, prop: string, callback: RemoteCallback) => void;
  'remote:set': (ns: string, id: string, prop: string, value: any, callback: RemoteCallback) => void;
  'remote:invoke': (ns: string, id: string, method: string, args: any[], callback: RemoteCallback) => void;
  'remote:subscribe': (ns: string, id: string, event: string, callback: RemoteCallback) => void;
  'remote:unsubscribe': (ns: string, id: string, event: string, callback: RemoteCallback) => void;
}

export type RemoteDelgate = () => void;

export type RemoteProperties = {
  root: {

  };
}

export type RemoteInvocations = {
  root: {

  };
}

export type RemoteEvents = {
  root: {

  };
}
