import EventEmitter from "events";
import http from "http";
import { capitalize, isEqual, isFunction, isObject, mapValues, noop, omit, pickBy } from "lodash";
import { Server as IOServer, Socket as IOSocket } from "socket.io";
import msgpackParser from 'socket.io-msgpack-parser';
import { ConditionalKeys } from "type-fest";
import { TypedEmitter } from "tiny-typed-emitter";
import { getDependents } from "./decorator";
import { ClientEvents, RemoteCallback, RemoteResponse, ServerEvents } from "./events";
import { $Exposing } from "./expose";
import { isProperty, isPublicPropertyName, propertyDescriptorOf } from "./utils";
import { ObservedPropertyChange, ObservedPropertyHandler, WithoutEvents } from "./types";

export class SocketServer extends IOServer<ClientEvents, ServerEvents> {
  constructor(httpServer: http.Server, path: string) {
    super(httpServer, {
      path,
      serveClient: false,
      transports: ['websocket'],
      parser: msgpackParser
    });
  }
}

export type Socket = IOSocket<ClientEvents, ServerEvents>;

type Handlers = {
  [key in keyof ClientEvents]: (socket: Socket, ...args: Parameters<ClientEvents[key]>) => any;
}

const isEvented = (value: any, object: any) => isFunction(value) && object instanceof EventEmitter;

export type SocketServerEvents = {
  ready(): void;
}

export class SocketServerController<Remote> extends TypedEmitter<SocketServerEvents> {
  constructor(protected io: SocketServer) {
    super();
    io.on('connection', socket => this.addSocket(socket));
  }

  private objectNamespaces = new Map<string, Map<string, ObjectObserver<object>>>();

  private socketSubscriptions = new Map<Socket, Map<object, { [event: string]: (...args: any[]) => any }>>();

  private socketObservations = new Map<Socket, Map<`${string}:${string}`, ObservedPropertyHandler<any>>>();

  protected addSocket(socket: Socket) {
    for (const [name, handler] of Object.entries(this.handlers)) {
      socket.on(name as keyof ClientEvents, (...args: any[]) => {
        handler(socket, ...args);
      });
    }

    socket.on('disconnect', () => this.removeSocket(socket))
  }

  private removeSocket(socket: Socket) {
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

  /**
   * Interact with a remote object specified by kind, id altogether
   *
   */
  private async interact(
    kind: string, id: string, key: string | undefined,
    predicate: (value: any, object: any, observer: ObjectObserver<any> | undefined) => boolean,
    execute: (object: any, value: any, observer: ObjectObserver<any> | undefined) => Promise<any>,
    callback: RemoteCallback<any>
  ) {
    const namespace = this.objectNamespaces.get(kind);
    const object = namespace?.get(id) as any;
    const observed = object instanceof ObjectObserver ? object : undefined;
    const instance = observed?.instance ?? object;

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

          console.error(e);
        }
      } else {
        resp = {
          status: 'key',
          key: key!
        }
      }
    } else {
      resp = {
        status: 'id',
        id
      }
    }

    if (isFunction(callback)) {
      callback(resp);
    }
  }

  private handlers: Handlers = {
    'remote:get': async (socket, kind, id, prop, callback) => {
      this.interact(
        kind, id, prop,
        (value, object, observed) => observed?.isPublishedProperty(prop) ?? false,
        async (_, value) => value,
        callback
      );
    },

    'remote:set': async (socket, kind, id, prop, value, callback) => {
      this.interact(
        kind, id, prop,
        (value, object, observed) => observed?.isPublishedProperty(prop) ?? false,
        async (object) => {
          const asyncSetterName = `asyncSet${capitalize(prop)}`;

          if (asyncSetterName in object) {
            const fn = (object as any)[asyncSetterName];
            if (isFunction(fn)) {
              await fn.call(object, value);
              return object[prop];
            }
          }

          object[prop] = value;
          return object[prop];
        },
        callback
      );
    },

    /**
     * Client requests to observe for changes of a remote object
     */
    'remote:observe': async (socket, kind, id, options, callback) => {
      this.interact(
        kind, id, undefined,
        (value, object) => !!object,
        async (object, _, observed) => {
          if (!this.socketObservations.has(socket)) {
            this.socketObservations.set(socket, new Map());
          }

          const observation = this.socketObservations.get(socket)!;
          const key = `${kind}:${id}` as `${string}:${string}`;

          if (!observation.has(key)) {
            const observer: ObservedPropertyHandler<any> = async (stub, changes) => {
              if (options?.ignoreOldValue) {
                changes = changes.map(c => omit(c, 'o'));
              }

              // Inform clients whenever a property of an observing object changed
              socket.emit('r:u', kind, id, changes);
            }

            observation.set(key, observer);
          }

          return observed?.getAll();
        },
        callback
      )
    },

    'remote:unobserve': async (socket, kind, id, callback) => {
      this.interact(
        kind, id, undefined,
        (value, object) => !!object,
        async (object, _, observerd) => {
          if (this.socketObservations.has(socket)) {
            const key = `${kind}:${id}` as `${string}:${string}`;
            const observation = this.socketObservations.get(socket)!;
            observation.delete(key);
          }
        },
        callback
      )
    },

    'remote:invoke': async (socket, kind, id, method, args, callback) => {
      // TODO: Support returning stream back to client
      // The idea is, when the returned value is a stream, just send some placeholder for referencing the stream
      // then start emitting stream data with new event
      this.interact(
        kind, id, method,
        // predicate
        (func, object, observer) => isFunction(func) && (observer?.isPublishedMethod(method) ?? false),
        // executor
        async (object, fn: Function) => fn.apply(object, args),
        callback
      );
    },

    /**
     * Client requests to subscribe to an event of a remote object
     */
    'remote:subscribe': async (socket, kind, id, event, callback) => {
      this.interact(
        kind, id, 'on',
        isEvented,
        async (object: EventEmitter) => {
          const handler = (...args: any[]) => {
            socket.emit('r:e', kind, id, event, ...args);
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

          object.on(event, handler);
          eventHandlerMap[event] = handler;

          return true;
        },
        callback
      );
    },

    'remote:unsubscribe': async (socket, kind, id, event, callback) => {
      this.interact(kind, id, 'off', isEvented, async (object: EventEmitter) => {
        this.unsubscribe(socket, object, event);
      }, callback);
    }
  }

  protected register<Kind extends Extract<ConditionalKeys<Remote, object>, string>>(kind: Kind, id: string, o: WithoutEvents<Remote[Kind]>) {
    if (typeof o !== 'object') {
      return;
    }

    if (!this.objectNamespaces.has(kind)) {
      this.objectNamespaces.set(kind, new Map());
    }

    const scoped = this.objectNamespaces.get(kind)!;
    const instance = o as unknown as object;

    if (scoped.get(id)?.instance === instance) {
      // Already registered
      return;
    }

    this.deregister(kind, id);
    this.objectNamespaces.get(kind)?.set(id, new ObjectObserver(instance, this.makeObserverPropertyHandler(kind, id)));
  }

  protected deregister<Kind extends Extract<ConditionalKeys<Remote, object>, string>>(kind: Kind, id: string) {
    const namespace = this.objectNamespaces.get(kind);
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
        if (key === `${kind}:${id}`) {
          observations.delete(key);
        }
      }

      if (observations.size <= 0) {
        this.socketObservations.delete(socket);
      }
    }


    namespace.delete(id);

    if (namespace.size <= 0) {
      this.objectNamespaces.delete(kind);
    }
  }

  private makeObserverPropertyHandler = (kind: string, id: string): ObservedPropertyHandler<any> => async (stub, changes) => {
    for (const [, socket] of this.io.sockets.sockets) {
      const observation = this.socketObservations.get(socket);


      if (observation) {
        const key = `${kind}:${id}` as `${string}:${string}`;
        const handler = observation.get(key);

        handler?.(stub, changes).catch(noop);
      }
    }
  }
}

type TypedPropertyDescriptorOf = TypedPropertyDescriptor<any> & {
  instance: object;
  name: string;
}

function bindDescInstance(instance: object, name: string, desc: TypedPropertyDescriptor<any>): TypedPropertyDescriptorOf {
  return {
    ...desc,
    name,
    instance
  }
}

export class ObjectObserver<T extends object> {
  readonly #methods: Record<string, TypedPropertyDescriptorOf>;

  readonly #exposingProps: Record<string, TypedPropertyDescriptorOf>;

  readonly #declaredProps: Record<string, TypedPropertyDescriptorOf>;

  constructor(readonly instance: T, private readonly notify: ObservedPropertyHandler<T>) {
    const exposingInstance = this.getExposing();

    const own = propertyDescriptorOf(instance);
    const proto = propertyDescriptorOf(Object.getPrototypeOf(instance));

    const declared = mapValues({ ...own, ...proto }, (desc, name) => bindDescInstance(instance, name, desc));

    const exposing = exposingInstance
      ? mapValues(
          {
          ...propertyDescriptorOf(exposingInstance),
          ...propertyDescriptorOf(Object.getPrototypeOf(exposingInstance))
          },
          (desc, name) => bindDescInstance(exposingInstance, name, desc)
        )
      : undefined;

    this.#methods = pickBy(declared, desc => isFunction(desc.value));
    this.#exposingProps = pickBy(exposing, desc => (desc.name in declared) && isProperty(desc) && isPublicPropertyName(desc.name));
    this.#declaredProps = pickBy(declared, desc => isProperty(desc) && isPublicPropertyName(desc.name));

    for (const [prop, desc] of Object.entries(this.#exposingProps)) {
      Object.defineProperty(desc.instance, prop, {
        get: () => {
          return desc.get ? desc.get.call(desc.instance) : desc.value;
        },

        set: (v) => {
          const changes: ObservedPropertyChange[] = [];

          const dependents = getDependents(instance, prop)
            .map(d => {
              const dep = this.#exposingProps[d];
              if (!dep) {
                return undefined;
              }

              const oldValue = dep.get ? dep.get.call(dep.instance) : dep.value;

              return [dep, oldValue];
            })
            .filter((d): d is [dep: TypedPropertyDescriptorOf, oldValue: any] => d !== undefined);

          const old = desc.get?.call(desc.instance) ?? desc.value;

          if (desc.set) {
            desc.set.call(desc.instance, v);
          } else {
            desc.value = v;
          }

          if (typeof prop === 'string' && this.isPublishedProperty(prop) && !isEqual(old, v)) {
            changes.push({ p: prop, o: old, n: v });

            for (const [dep, oldValue] of dependents) {
              changes.push({
                p: dep.name,
                o: oldValue,
                n: dep.get ? dep.get.call(dep.instance) : dep.value
              })
            }

            this.notify(instance, changes);
          }
        }
      })
    }
  }

  private getExposing() {
    if ($Exposing in this.instance) {
      const exposed = (this.instance as any)[$Exposing];

      if (isObject(exposed)) {
        return exposed;
      }
    }
  }

  /**
   * Get a copy of all property values
   */
  getAll() {
    const props = new Set([
      ...Object.keys(this.#declaredProps),
      ...Object.keys(this.#exposingProps)
    ]);

    return Array.from(props).reduce((o, prop) => {
      const declared = this.#declaredProps[prop];
      const exposing = this.#exposingProps[prop];
      o[prop] =
        (declared.value ?? declared.get?.call(declared.instance))
        ?? (exposing.value ?? exposing.get?.call(exposing.instance))
      return o;
    }, {} as any) as T;
  }

  isPublishedProperty(name: string) {
    return name in this.#exposingProps;
  }

  isPublishedMethod(name: string) {
    return name in this.#methods;
  }
}
