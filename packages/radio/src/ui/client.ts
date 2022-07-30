import { io, Socket } from "socket.io-client";
import { ClientEvents, RemoteEvents, RemoteInvocations, RemoteProperties, RemoteResponse, ServerEvents } from '../socket/events';

export class Client {
  private socket: Socket<ServerEvents, ClientEvents>;

  private delegates = new Map<`${string}:${string}`, { [event: string]: (...args: any[]) => any }>();

  constructor() {
    this.socket = io({ transports: ['websocket'] });
    this.socket.on('remote:event', (ns, id, event, ...args) => {
        const key = `${ns}:${id}` as const;

        const delegate = this.delegates.get(key)?.[event];
        delegate?.(...args);
    });
  }

  readonly remote = {
    get: <
      NS extends keyof RemoteProperties,
      P extends keyof O,
      O = RemoteProperties[NS]
    >(
      ns: Extract<NS, string>,
      id: string,
      prop: Extract<P, string>
    ): Promise<O[P]> => {
      return new Promise((resolve, reject) => {
        this.socket.emit('remote:get', ns, id, prop, async (response: RemoteResponse<O[P]>) => {
          if (response.status === 'ok') {
            resolve(response.result);
            return;
          }

          reject(response.reason);
        });
      });
    },

    set: <
      NS extends keyof RemoteProperties,
      P extends keyof O,
      O = RemoteProperties[NS]
    >(
      ns: Extract<NS, string>,
      id: string,
      prop: Extract<P, string>,
      value: O[P]
    ): Promise<O[P]> => {
      return new Promise((resolve, reject) => {
        this.socket.emit('remote:set', ns, id, prop, value, async (response: RemoteResponse<O[P]>) => {
          if (response.status === 'ok') {
            resolve(response.result);
            return;
          }

          reject(response.reason);
        });
      });
    },

    invoke: <
      NS extends keyof RemoteInvocations,
      N extends Extract<keyof M, string>,
      M extends { [method: string]: (...args: any[]) => any } = RemoteInvocations[NS]
    >(ns: NS, id: string, method: N, args: Parameters<M[N]>) => new Promise<ReturnType<M[N]>>(
      (resolve, reject) => {
        this.socket.emit('remote:invoke', ns, id, method, args, async (response: RemoteResponse<ReturnType<M[N]>>) => {
          if (response.status === 'ok') {
            resolve(response.result);
            return;
          }

          reject(response.reason);
        });
      }
    ),

    subscribe: <
      NS extends keyof RemoteEvents,
      N extends Extract<keyof E, string>,
      E extends { [method: string]: (...args: any[]) => any } = RemoteEvents[NS]
    >(ns: NS, id: string, event: N, delegate: (...args: Parameters<E[N]>) => void) => new Promise<void>(
      (resolve, reject) => {
        this.socket.emit('remote:subscribe', ns, id, event, async (response: RemoteResponse<void>) => {
          if (response.status === 'ok') {
            resolve(response.result);

            const key = `${ns}:${id}` as const;

            if (!this.delegates.has(key)) {
              this.delegates.set(key, {});
            }

            this.delegates.get(key)![event] = delegate;

            return;
          }

          reject(response.reason);
        });
      }
    ),

    unsubscribe: <
      NS extends keyof RemoteEvents,
      N extends Extract<keyof E, string>,
      E extends { [method: string]: (...args: any[]) => any } = RemoteEvents[NS]
    >(ns: NS, id: string, event: N, delegate: (...args: Parameters<E[N]>) => void) => new Promise<void>(
      (resolve, reject) => {
        this.socket.emit('remote:unsubscribe', ns, id, event, async (response: RemoteResponse<void>) => {
          if (response.status === 'ok') {
            resolve(response.result);

            const key = `${ns}:${id}` as const;
            const stored = this.delegates.get(key) ?? {};

            if (stored[event] === delegate) {
              delete stored[event];
            }

            return;
          }

          reject(response.reason);
        });
      }
    )
  }
}
