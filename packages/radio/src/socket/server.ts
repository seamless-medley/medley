import EventEmitter from "events";
import http from "http";
import { isFunction } from "lodash";
import { Server as IOServer, Socket as IOSocket } from "socket.io";
import { ClientEvents, RemoteCallback, ServerEvents } from "./events";

export class SocketServer extends IOServer<ClientEvents, ServerEvents> {
  constructor(httpServer: http.Server, path: string) {
    super(httpServer, {
      path,
      serveClient: false,
      transports: ['websocket'],
      // parser: msgpackParser
    });
  }
}

type Socket = IOSocket<ClientEvents, ServerEvents>;

type Handlers = {
  [key in keyof ClientEvents]: (socket: Socket, ...args: Parameters<ClientEvents[key]>) => any;
}

export class SocketServerController {
  constructor(io: SocketServer) {
    io.on('connection', (socket) => {
      for (const [name, handler] of Object.entries(this.handlers)) {
        socket.on(name as any, (...args: any[]) => {
          (handler as any)(socket, ...args);
        });
      }

      socket.on('disconnect', () => {
        this.subscriptions.delete(socket);
      })
    });
  }

  private objectNamespaces = new Map<string, Map<string, object>>();

  private subscriptions = new WeakMap<Socket, WeakMap<object, (...args: any[]) => any>>();

  private async interact(ns: string, id: string, key: string, predicate: (value: any) => boolean, execute: (object: any, value: any) => Promise<any>, callback: RemoteCallback<any>) {
    const namespace = this.objectNamespaces.get(ns);
    const object = namespace?.get(id) as any;

    let error = undefined;
    let result = undefined;

    if (object) {
      const value = object[key];

      if (predicate(value)) {
        try {
          result = await execute(object, value);
        }
        catch (e: any) {
          error = `Exception: ${e.message || e}`;
        }
      } else {
        error = 'Inaccessible';
      }
    } else {
      error = 'Invalid id';
    }

    if (isFunction(callback)) {
      callback(error === undefined
        ? {
          status: 'ok',
          result
        }
        : {
          status: 'error',
          reason: error
        });
    }
  }

  private handlers: Handlers = {
    'remote:get': async (socket, ns, id, prop, callback) => {
      this.interact(ns, id, prop, value => !isFunction(value), (_, value) => value, callback);
    },

    'remote:set': async (socket, ns, id, prop, value, callback) => {
      this.interact(ns, id, prop, value => !isFunction(value), (object) => {
        object[prop] = value;
        return object[prop];
      }, callback);
    },

    'remote:invoke': async (socket, ns, id, method, args, callback) => {
      this.interact(ns, id, method, isFunction, (object, fn: Function) => fn.apply(object, args), callback);
    },

    'remote:subscribe': async (socket, ns, id, event, callback) => {
      this.interact(ns, id, 'on', isFunction, async (object: EventEmitter) => {
        const handler = (...args: any[]) => {
          socket.emit('remote:event', ns, id, event, ...args);
        };

        if (!this.subscriptions.has(socket)) {
          this.subscriptions.set(socket, new Map());
        }

        this.subscriptions.get(socket)?.set(object, handler);

        object.on(event, handler);
      }, callback);
    },

    'remote:unsubscribe': async (socket, ns, id, event, callback) => {
      this.interact(ns, id, 'off', isFunction, async (object: EventEmitter) => {
        const subscription = this.subscriptions.get(socket);
        const handler = subscription?.get(object);

        if (handler) {
          object.off(event, handler)
        }

        subscription?.delete(object);

      }, callback);
    }
  }

  register<O extends object>(ns: string, id: string, o: O) {
    if (!this.objectNamespaces.has(ns)) {
      this.objectNamespaces.set(ns, new Map());
    }

    this.objectNamespaces.get(ns)?.set(id, o);
  }
}
