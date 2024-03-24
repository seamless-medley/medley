import { Readable } from 'node:stream';
import EventEmitter from "node:events";
import http from "node:http";
import { capitalize, isEqual, isFunction, isObject, mapValues, mean, noop, omit, pickBy, random } from "lodash";
import { Server as IOServer } from "socket.io";
import msgpackParser from 'socket.io-msgpack-parser';
import { ConditionalKeys } from "type-fest";
import { TypedEmitter } from "tiny-typed-emitter";

import {
  $Exposing, ObservedPropertyChange, ObservedPropertyHandler, WithoutEvents,
  ClientEvents, RemoteCallback, RemoteResponse, ServerEvents,
  isProperty, isPublicPropertyName, isReadableStream, propertyDescriptorOf, AuthData
} from "../../socket";

import { Socket, ClientData } from './types';

import { createLogger } from '@seamless-medley/logging';
import { SettingsDb } from '../../db/types';
import { getDependents, hasObjectGuardAccess } from './decorator';
import { PlainUser } from '../../db/persistent/user';
import { $ActualObject } from '../../db/models/base';

const logger = createLogger({ name: 'socket-server' });

export class SocketServer extends IOServer<ClientEvents, ServerEvents, never, ClientData> {
  constructor(httpServer: http.Server, path: string) {
    super(httpServer, {
      path,
      serveClient: false,
      transports: ['websocket'],
      parser: msgpackParser
    });
  }
}

type Handlers = {
  [key in keyof ClientEvents]: (socket: Socket, ...args: Parameters<ClientEvents[key]>) => any;
}

const isEvented = (value: any, object: any) => isFunction(value) && object instanceof EventEmitter;

const isAuthData = (o: any): o is AuthData => {
  if (Array.isArray(o?.nn) && o.nn.length) {
    if (Array.isArray(o?.up) && o.up.length === 2) {
      return Array.isArray(o.up[0]) && Array.isArray(o.up[1]);
    }
  }

  return false;
}


export type SocketServerEvents = {
  ready(): void;
}

export class SocketServerController<Remote> extends TypedEmitter<SocketServerEvents> {
  constructor(protected io: SocketServer) {
    super();
    io.on('connection', socket => this.addSocket(socket));
    setInterval(this.#pingSockets, 1000);
  }

  #objectNamespaces = new Map<string, Map<string, ObjectObserver<object>>>();

  #socketSubscriptions = new Map<Socket, Map<object, { [event: string]: (...args: any[]) => any }>>();

  #socketObservations = new Map<Socket, Map<`${string}:${string}`, ObservedPropertyHandler<any>>>();

  #sendSession(socket: Socket) {
    socket.emit('c:s', {
      user: socket.data.user?.toPlain()
    });
  }

  protected async addSocket(socket: Socket) {
    logger.debug({ socket: socket.id }, 'Adding socket');

    socket.data = {
      latencyBacklog: []
    };

    for (const key of Object.keys(this.#handlers)) {
      const name = key as keyof ClientEvents;

      socket.on(name, (...args: any[]) => {
        const handler = this.#handlers[name] as (socket: Socket, ...args: any[]) => any;
        handler(socket, ...args);
      });
    }

    socket.on('disconnect', () => this.#removeSocket(socket));

    if (isAuthData(socket.handshake.auth)) {
      const { auth: { nn, up } } = socket.handshake;
      await this.#handleAuth(socket, nn, up[0], up[1]);
    }

    this.#sendSession(socket);
  }

  #pingSockets = async () => {
    const sockets = await this.io.sockets.fetchSockets();

    for (const socket of sockets) {
      if (performance.now() - (socket.data.lastPing ?? 0) >= 5e3) {
        // Do ping
        const sentTime = performance.now();
        socket.data.lastPing = sentTime;
        socket.emit('s:p', sentTime, (rcvdTime) => {
          socket.data.latencyBacklog.push((performance.now() - rcvdTime) / 2);
          if (socket.data.latencyBacklog.length > 5) {
            socket.data.latencyBacklog.shift();
          }

          socket.emit('c:l', mean(socket.data.latencyBacklog) || 0);
        });
      }
    }
  }

  #removeSocket(socket: Socket) {
    const subscriptions = this.#socketSubscriptions.get(socket);

    if (subscriptions) {
      for (const [object, eventHandlerMap] of [...subscriptions]) {
        if (object instanceof EventEmitter) {
          for (const event of Object.keys(eventHandlerMap)) {
            this.#unsubscribe(socket, object, event);
          }
        }
      }
    }

    this.#socketSubscriptions.delete(socket);


    if (this.#socketObservations.has(socket)) {
      this.#socketObservations.delete(socket);
    }
  }

  #unsubscribe(socket: Socket, object: EventEmitter, event: string) {
    const socketSubscriptions = this.#socketSubscriptions.get(socket);

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

  #registeredStreams = new Map<number, Readable>();

  #makeStreamId() {
    while (true) {
      const id = random(2 ** 31);

      if (this.#registeredStreams.has(id)) {
        continue;
      }

      return id;
    }
  }

  #registerStream(socket: Socket, stream: Readable): [number, number] {
    const id = this.#makeStreamId();

    stream.on('data', data => {
      if (Buffer.isBuffer(data)) {
        socket.emit('r:sd', id, data);
      }
    });


    stream.on('close', () => {
      this.#registeredStreams.delete(id);
      socket.emit('r:sc', id);
    });

    return [id, id ^ 0x1eafc0b7];
  }

  /**
   * Interact with a remote object specified by kind, id altogether
   *
   */
  async #interact(
    socket: Socket,
    kind: string, id: string, key: string | undefined,
    predicate: (value: any, object: any, observer: ObjectObserver<any> | undefined) => boolean,
    execute: (object: any, value: any, observer: ObjectObserver<any> | undefined) => Promise<any>,
    callback: RemoteCallback<any>
  ) {
    const namespace = this.#objectNamespaces.get(kind);
    const object = namespace?.get(id) as any;
    const observed = object instanceof ObjectObserver ? object : undefined;
    const instance: Record<any, any> = observed?.instance ?? object;
    const cb = isFunction(callback) ? callback : undefined;

    if (typeof instance !== 'object') {
      cb?.({
        status: 'id',
        id
      });

      return;
    }

    if (!await hasObjectGuardAccess(socket, instance)) {
      cb?.({
        status: 'prohibited',
        id
      });

      return;
    }

    if (!await hasObjectGuardAccess(socket, instance, key)) {
      cb?.({
        status: 'prohibited',
        id,
        key
      });

      return;
    }

    const value = key ? instance[key] : undefined;

    if (!predicate(value, instance, observed)) {
      cb?.({
        status: 'key',
        key: key!
      });

      return;
    }

    try {
      const result = await execute(instance, value, observed);

      let resp: RemoteResponse<any> = { status: undefined, result };

      if (isReadableStream(result)) {
        resp = {
          status: 'stream',
          result: this.#registerStream(socket, result)
        }
      }

      cb?.(resp);
    }
    catch (e: any) {
      cb?.({
        status: 'exception',
        message: `${e.message || e}`
      });

      logger.error({ err: e, kind, id, key }, `Error interacting`);
    }
  }

  protected async authenticateSocket(socket: Socket, username: string, password: string): Promise<ClientData['user']> {
    return undefined;
  }

  async #handleAuth(socket: Socket, nn: number[], u: number[], p: number[]) {
    const up = [u, p].map((e, ki) => Buffer.from(e.map((a,i) => 0xbe^a^nn[ki]^i)).toString());
    const user = await this.authenticateSocket(socket, up[0], up[1]);
    socket.data.user = user;
  }

  #handlers: Handlers = {
    'c:a': async (socket, nn, u, p) => {
      await this.#handleAuth(socket, nn, u, p);
      this.#sendSession(socket);
    },

    'r:pg': async (socket, kind, id, prop, callback) => {
      this.#interact(
        socket,
        kind, id, prop,
        (value, object, observed) => observed?.isPublishedProperty(prop) ?? false,
        async (_, value) => value,
        callback
      );
    },

    'r:ps': async (socket, kind, id, prop, value, callback) => {
      this.#interact(
        socket,
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
    'r:ob': async (socket, kind, id, options, callback) => {
      this.#interact(
        socket,
        kind, id, undefined,
        (value, object) => !!object,
        async (object, _, observed: ObjectObserver<object> | undefined) => {
          if (!this.#socketObservations.has(socket)) {
            this.#socketObservations.set(socket, new Map());
          }

          const observation = this.#socketObservations.get(socket)!;
          const key = `${kind}:${id}` as `${string}:${string}`;

          if (!observation.has(key)) {
            const observer: ObservedPropertyHandler<object> = async (stub, changes) => {
              if (options?.ignoreOldValue) {
                changes = changes.map(c => omit(c, 'o'));
              }

              // Inform clients whenever a property of an observing object changed
              socket.emit('r:u', kind, id, changes);
            }

            observation.set(key, observer);
          }

          const allProps = observed?.getAll();

          if (!allProps) {
            return;
          }

          const propsWithGuards = await Promise.all(Object.entries(allProps).map(async ([prop, value]) => ({
            prop,
            value,
            allowed: await hasObjectGuardAccess(socket, object, prop)
          })));

          return propsWithGuards.filter(({ allowed }) => allowed).reduce((a, { prop, value }) => {
            a[prop] = value;
            return a;
          }, {} as Record<any, any>);

        },
        callback
      )
    },

    'r:ub': async (socket, kind, id, callback) => {
      this.#interact(
        socket,
        kind, id, undefined,
        (value, object) => !!object,
        async (object, _, observerd) => {
          if (this.#socketObservations.has(socket)) {
            const key = `${kind}:${id}` as `${string}:${string}`;
            const observation = this.#socketObservations.get(socket)!;
            observation.delete(key);
          }
        },
        callback
      )
    },

    'r:mi': async (socket, kind, id, method, args, callback) => {
      this.#interact(
        socket,
        kind, id, method,
        // predicate
        (func, object, observer) => isFunction(func) && (observer?.isPublishedMethod(method) ?? false),
        // executor
        async (object, fn: Function) => fn.apply(object, [...args, socket]),
        callback
      );
    },

    /**
     * Client requests to subscribe to an event of a remote object
     */
    'r:es': async (socket, kind, id, event, callback) => {
      this.#interact(
        socket,
        kind, id, 'on',
        isEvented,
        async (object: EventEmitter) => {
          const handler = (...args: any[]) => {
            socket.emit('r:e', kind, id, event, ...args);
          };

          if (!this.#socketSubscriptions.has(socket)) {
            this.#socketSubscriptions.set(socket, new Map());
          }

          const socketSubscriptions = this.#socketSubscriptions.get(socket)!;

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

    'r:eu': async (socket, kind, id, event, callback) => {
      this.#interact(
        socket,
        kind, id, 'off',
        isEvented,
        async (object: EventEmitter) => {
          this.#unsubscribe(socket, object, event);
        },
        callback
      );
    }
  }

  protected register<Kind extends Extract<ConditionalKeys<Remote, object>, string>>(kind: Kind, id: string, o: WithoutEvents<Remote[Kind]>) {
    if (typeof o !== 'object') {
      return;
    }

    if (!this.#objectNamespaces.has(kind)) {
      this.#objectNamespaces.set(kind, new Map());
    }

    const scoped = this.#objectNamespaces.get(kind)!;
    const instance = o as unknown as object;

    if (scoped.get(id)?.instance === instance) {
      // Already registered
      return;
    }

    this.deregister(kind, id);
    this.#objectNamespaces.get(kind)?.set(id, new ObjectObserver(instance, this.#makeObserverPropertyHandler(kind, id)));
  }

  protected deregister<Kind extends Extract<ConditionalKeys<Remote, object>, string>>(kind: Kind, id: string) {
    const namespace = this.#objectNamespaces.get(kind);
    if (!namespace) {
      return;
    }

    if (!namespace?.has(id)) {
      return;
    }

    const object = namespace.get(id)!;

    if (object instanceof EventEmitter) {
      for (const [socket, subscriptions] of [...this.#socketSubscriptions]) {
        for (const [o, events] of subscriptions) {
          if (o === object) {
            for (const [event, handler] of Object.entries(events)) {
              object.off(event, handler)
            }
          }
        }

        if (subscriptions.size <= 0) {
          this.#socketSubscriptions.delete(socket);
        }
      }
    }

    for (const [socket, observations] of [...this.#socketObservations]) {
      for (const key of [...observations.keys()]) {
        if (key === `${kind}:${id}`) {
          observations.delete(key);
        }
      }

      if (observations.size <= 0) {
        this.#socketObservations.delete(socket);
      }
    }


    namespace.delete(id);

    if (namespace.size <= 0) {
      this.#objectNamespaces.delete(kind);
    }
  }

  #makeObserverPropertyHandler = (kind: string, id: string): ObservedPropertyHandler<object> => async (instance, changes) => {
    for (const [, socket] of this.io.sockets.sockets) {
      if (!await hasObjectGuardAccess(socket, instance)) {
        continue;
      }

      const observation = this.#socketObservations.get(socket);

      if (observation) {
        const changesWithGuards = await Promise.all(changes.map(async change => ({
          change,
          allowed: await hasObjectGuardAccess(socket, instance, change.p)
        })));

        const filteredChanges = changesWithGuards.filter(({ allowed }) => allowed).map(({ change }) => change);

        if (filteredChanges.length) {
          const key = `${kind}:${id}` as `${string}:${string}`;
          const handler = observation.get(key);

          handler?.(instance, filteredChanges).catch(noop);
        }
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
  readonly #methods: Partial<Record<string, TypedPropertyDescriptorOf>>;

  readonly #exposingProps: Partial<Record<string, TypedPropertyDescriptorOf>>;

  readonly #declaredProps: Partial<Record<string, TypedPropertyDescriptorOf>>;

  constructor(readonly instance: T, private readonly notify: ObservedPropertyHandler<T>) {
    const exposingInstance = this.#getExposing();

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
    this.#exposingProps = pickBy(exposing, desc => (desc.name in declared) && !(desc.name in this.#methods) && isPublicPropertyName(desc.name));
    this.#declaredProps = pickBy(declared, desc => {
      if (desc.instance instanceof EventEmitter) {
        if (['domain'].includes(desc.name)) {
          return false;
        }
      }

      return isProperty(desc) && isPublicPropertyName(desc.name)
    });

    for (const [prop, desc] of Object.entries(this.#exposingProps)) {
      if (!desc) {
        continue;
      }

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

  #getExposing() {
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
        (declared?.value ?? declared?.get?.call(declared.instance))
        ?? (exposing?.value ?? exposing?.get?.call(exposing.instance))

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
