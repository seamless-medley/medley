import EventEmitter from "events";
import http from "http";
import { isFunction, noop, pickBy} from "lodash";
import { Server as IOServer, Socket as IOSocket } from "socket.io";
import { ConditionalKeys } from "type-fest";
import { ClientEvents, RemoteCallback, RemoteResponse, ServerEvents } from "./events";
import { isProperty, propertyDescriptorOf } from "./remote";
import { EventEmitterOf } from "./types";

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

const isEvented = (value: any, object: any) => isFunction(value) && object instanceof EventEmitter;

export class SocketServerController<Remote> {
  constructor(private io: SocketServer) {
    io.on('connection', this.addSocket);
  }

  private objectNamespaces = new Map<string, Map<string, Observer<object>>>();

  private socketSubscriptions = new Map<Socket, Map<object, { [event: string]: (...args: any[]) => any }>>();

  private socketObservations = new Map<Socket, Map<`${string}:${string}`, ObservedPropertyHandler>>();

  private addSocket = (socket: Socket) => {
    for (const [name, handler] of Object.entries(this.handlers)) {
      socket.on(name as keyof ClientEvents, (...args: any[]) => {
        handler(socket, ...args);
      });
    }

    socket.on('disconnect', () => this.removeSocket(socket))
  }

  private removeSocket(socket: Socket) {
    console.log('Removing socket', socket.id);

    const subscriptions = this.socketSubscriptions.get(socket);

    if (subscriptions) {
      for (const [object, eventHandlerMap] of [...subscriptions]) {
        if (object instanceof EventEmitter) {
          for (const event of Object.keys(eventHandlerMap)) {
            this.unsubscribe(socket, object, event);
          }
        }
      }
    }

    this.socketSubscriptions.delete(socket);


    if (this.socketObservations.has(socket)) {
      this.socketObservations.delete(socket);
    }
  }

  private unsubscribe(socket: Socket, object: EventEmitter, event: string) {
    const socketSubscriptions = this.socketSubscriptions.get(socket);

    if (!socketSubscriptions) {
      return;
    }

    const handlers = socketSubscriptions.get(object);

    if (!handlers) {
      return;
    }

    const handler = handlers[event];

    if (handler) {
      object.off(event, handler)
    }

    delete handlers[event];

    if (Object.values(handlers).length <= 0) {
      socketSubscriptions.delete(object);
    }
  }

  private async interact(
    ns: string, id: string, key: string | undefined,
    predicate: (value: any, object: any, observer: Observer<any> | undefined) => boolean,
    execute: (object: any, value: any, observer: Observer<any> | undefined) => Promise<any>,
    callback: RemoteCallback<any>
  ) {
    const namespace = this.objectNamespaces.get(ns);
    const object = namespace?.get(id) as any;
    const observed = object instanceof Observer ? object : undefined;
    const instance = observed?.observed ?? object;

    let result = undefined;

    let resp: RemoteResponse<any>;

    if (typeof instance === 'object') {
      const value = key ? instance[key] : undefined;

      if (predicate(value, instance, observed)) {
        try {
          result = await execute(instance, value, observed);
          resp = { status: undefined, result };
        }
        catch (e: any) {
          resp = {
            status: 'exception',
            message: `${e.message || e}`
          }
        }
      } else {
        resp = { status: 'key' }
      }
    } else {
      resp = { status: 'id' }
    }

    if (isFunction(callback)) {
      callback(resp);
    }
  }

  private handlers: Handlers = {
    'remote:get': async (socket, ns, id, prop, callback) => {
      this.interact(
        ns, id, prop,
        (value, object, observed) => observed?.isPublishedProperty(prop) ?? false,
        async (_, value) => value,
        callback
      );
    },

    'remote:set': async (socket, ns, id, prop, value, callback) => {
      this.interact(
        ns, id, prop,
        (value, object, observed) => observed?.isPublishedProperty(prop) ?? false,
        async (object) => {
          object[prop] = value;
          return object[prop];
        },
        callback
      );
    },

    'remote:observe': async (socket, ns, id, callback) => {
      this.interact(
        ns, id, undefined,
        (value, object) => !!object,
        async (object, _, observed) => {
          if (!this.socketObservations.has(socket)) {
            this.socketObservations.set(socket, new Map());
          }

          const observation = this.socketObservations.get(socket)!;
          const key = `${ns}:${id}` as `${string}:${string}`;

          if (!observation.has(key)) {
            observation.set(key, async (prop, oldValue, newValue) => {
              socket.emit('remote:update', ns, id, prop, typeof oldValue !== 'object' ? oldValue : undefined, newValue);
            });
          }

          return observed?.getAll();
        },
        callback
      )
    },

    'remote:unobserve': async (socket, ns, id, callback) => {
      this.interact(
        ns, id, undefined,
        (value, object) => !!object,
        async (object, _, observerd) => {
          if (this.socketObservations.has(socket)) {
            const key = `${ns}:${id}` as `${string}:${string}`;
            const observation = this.socketObservations.get(socket)!;
            observation.delete(key);
          }
        },
        callback
      )
    },

    'remote:invoke': async (socket, ns, id, method, args, callback) => {
      this.interact(
        ns, id, method,
        // predicate
        (func, object, observer) => isFunction(func) && (observer?.isPublishedMethod(method) ?? false),
        // executor
        async (object, fn: Function) => fn.apply(object, args),
        callback
      );
    },

    'remote:subscribe': async (socket, ns, id, event, callback) => {
      this.interact(ns, id, 'on', isEvented, async (object: EventEmitter) => {
        const handler = (...args: any[]) => {
          console.log('Relaying event to clent', socket.id);
          socket.emit('remote:event', ns, id, event, ...args);
        };

        if (!this.socketSubscriptions.has(socket)) {
          this.socketSubscriptions.set(socket, new Map());
        }

        const socketSubscriptions = this.socketSubscriptions.get(socket)!;

        if (!socketSubscriptions.has(object)) {
          socketSubscriptions.set(object, {});
        }

        const eventHandlerMap = socketSubscriptions.get(object)!;

        if (eventHandlerMap[event]) {
          object.off(event, eventHandlerMap[event]);
        }

        console.log('Subscribe', ns, id, event, socket.id)

        object.on(event, handler);
        eventHandlerMap[event] = handler;
      }, callback);
    },

    'remote:unsubscribe': async (socket, ns, id, event, callback) => {
      this.interact(ns, id, 'off', isEvented, async (object: EventEmitter) => {
        this.unsubscribe(socket, object, event);
      }, callback);
    }
  }

  register<NS extends Extract<ConditionalKeys<Remote, object>, string>>(ns: NS, id: string, o: EventEmitterOf<Remote[NS]>) {
    if (typeof o !== 'object') {
      return;
    }

    if (!this.objectNamespaces.has(ns)) {
      this.objectNamespaces.set(ns, new Map());
    }

    const scoped = this.objectNamespaces.get(ns)!;
    const instance = o as unknown as object;

    if (scoped.get(id)?.observed === instance) {
      // Already registered
      console.log('Already registered');
      return;
    }

    this.deregister(ns, id);
    this.objectNamespaces.get(ns)?.set(id, new Observer(instance, this.emitProperyUpdate));
  }

  deregister<NS extends Extract<ConditionalKeys<Remote, object>, string>>(ns: NS, id: string) {
    const namespace = this.objectNamespaces.get(ns);
    if (!namespace) {
      return;
    }

    if (!namespace?.has(id)) {
      return;
    }

    const object = namespace.get(id)!;

    if (object instanceof EventEmitter) {
      for (const [socket, subscriptions] of [...this.socketSubscriptions]) {
        for (const [o, events] of subscriptions) {
          if (o === object) {
            for (const [event, handler] of Object.entries(events)) {
              object.off(event, handler)
            }
          }
        }

        if (subscriptions.size <= 0) {
          this.socketSubscriptions.delete(socket);
        }
      }
    }

    for (const [socket, observations] of [...this.socketObservations]) {
      for (const key of [...observations.keys()]) {
        if (key === `${ns}:${id}`) {
          observations.delete(key);
        }
      }

      if (observations.size <= 0) {
        this.socketObservations.delete(socket);
      }
    }


    namespace.delete(id);

    if (namespace.size <= 0) {
      this.objectNamespaces.delete(ns);
    }
  }

  emitProperyUpdate: ObservedPropertyHandler = async (prop, oldValue, newValue) => {
    for (const [, socket] of this.io.sockets.sockets) {
      const observation = this.socketObservations.get(socket);

      if (observation) {
        for (const handler of observation.values()) {
          handler(prop, oldValue, newValue).catch(noop);
        }
      }
    }
  }

}

type ObservedPropertyHandler = (prop: string, oldValue: any, newValue: any) => Promise<any>;

class Observer<T extends object> {
  readonly #methods: Record<string, TypedPropertyDescriptor<T>>;

  readonly #props: Record<string, TypedPropertyDescriptor<T>>;

  constructor(readonly observed: T, private readonly emitter: ObservedPropertyHandler) {
    const own = propertyDescriptorOf(observed);
    const proto = propertyDescriptorOf(Object.getPrototypeOf(observed));

    const mergedDescs = { ...own, ...proto };

    this.#methods = pickBy(mergedDescs, desc => isFunction(desc.value));
    this.#props = pickBy(mergedDescs, isProperty);

    for (const [prop, desc] of Object.entries(this.#props)) {
      Object.defineProperty(observed, prop, {
        get: () => desc.get?.call(observed) ?? desc.value,

        set: (v) => {
          const old = desc.get?.call(observed) ?? desc.value;

          if (typeof prop === 'string' && this.isPublishedProperty(prop) && old !== v) {
            this.emitter(prop, old, v);
          }

          desc.set ? desc.set.call(observed, v) : (desc.value = v);
        }
      })
    }
  }

  getAll() {
    return Object.entries(this.#props).reduce((o, [prop, desc]) => {
      o[prop] = desc.value ?? desc.get?.call(this.observed);
      return o;
    }, {} as any) as T;
  }

  isPublishedProperty(name: string) {
    return name in this.#props;
  }

  isPublishedMethod(name: string) {
    return name in this.#methods;
  }
}
