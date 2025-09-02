import { capitalize, isEqual, isFunction, isObject, mapValues, mean, noop, omit, pickBy, random, stubFalse } from "lodash";
import { Readable, Stream, Writable } from 'node:stream';
import EventEmitter from "node:events";
import http from "node:http";
import { Server as IOServer } from "socket.io";
import msgpackParser from 'socket.io-msgpack-parser';
import { ConditionalKeys } from "type-fest";
import { TypedEmitter } from "tiny-typed-emitter";
import { isProperty, isPublicPropertyName, propertyDescriptorOf } from '@seamless-medley/utils';

import type { Exposable, ClientEvents, RemoteCallback, RemoteResponse, ServerEvents, AuthData, ObservedPropertyChange, ObservedPropertyHandler, WithoutEvents, ClientAuthResult  } from "@seamless-medley/remote";

import { Socket, ClientSocketData, getSocketSession } from './types';

import { createLogger } from "../../logging";
import { getDependents, getPureExpose, hasObjectGuardAccess } from './decorator';

const logger = createLogger({ name: 'socket-server' });

function isStream(o: any): o is Stream  {
	return o !== null
		&& typeof o === 'object'
		&& typeof o.pipe === 'function';
}

function isWritableStream(o: any): o is Writable {
	return isStream(o)
		&& (o as any).writable !== false
		&& typeof (o as any)._write === 'function'
		&& typeof (o as any)._writableState === 'object';
}

function isReadableStream(o: any): o is Readable {
	return isStream(o)
		&& (o as any).readable !== false
		&& typeof (o as any)._read === 'function'
		&& typeof (o as any)._readableState === 'object';
}


export class SocketServer extends IOServer<ClientEvents, ServerEvents, never, ClientSocketData> {
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

type KindName = string;
type ObjectId = string;

export class SocketServerController<Remote> extends TypedEmitter<SocketServerEvents> {
  constructor(protected io: SocketServer) {
    super();
    io.on('connection', socket => this.addSocket(socket));
    setInterval(this.#pingSockets, 1000);
  }

  #objectGlobalObservers = new Map<KindName, Map<ObjectId, ObjectObserver<object>>>();

  #objectSocketObservers = new Map<Socket, Map<KindName, Map<ObjectId, ObjectObserver<object>>>>();

  #socketSubscriptions = new Map<Socket, Map<object, { [event: string]: (...args: any[]) => any }>>();

  #socketObservations = new Map<Socket, Map<`${string}:${string}`, ObservedPropertyHandler<any>>>();

  #sendSession(socket: Socket) {
    socket.emit('c:s', {
      user: socket.data.user?.username
    });
  }

  protected async addSocket(socket: Socket) {
    logger.debug({ socket: socket.id }, 'Adding socket');

    const session = getSocketSession(socket);

    // The express-session middleware saves the session when a request ends
    // but WebSocket connections persist beyond the request lifecycle, so the session must be saved explicitly
    session.save();

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

    if (isAuthData(session.auth)) {
      await this.#handleAuth(socket, session.auth);
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
        socket.emit('s:p', sentTime, (serverTime) => {
          socket.data.latencyBacklog.push((performance.now() - serverTime) / 2);
          if (socket.data.latencyBacklog.length > 5) {
            socket.data.latencyBacklog.shift();
          }

          socket.emit('c:l', mean(socket.data.latencyBacklog) || 0);
        });
      }
    }
  }

  #removeSocket(socket: Socket) {
    const registered = this.#registeredExposable.get(socket);

    if (registered) {
      for (const [id, exposable] of registered) {
        this.deregister(exposable.$Kind as any, id, socket);
        exposable.dispose();
      }

      this.#registeredExposable.delete(socket);
    }

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

  #makeEphemeralId(has: (id: number) => boolean) {
    while (true) {
      const id = random(2 ** 31);

      if (has(id)) {
        continue;
      }

      return id;
    }
  }

  #registeredStreams = new Map<number, Readable>();

  #registerStream(socket: Socket, stream: Readable): [number, number] {
    const id = this.#makeEphemeralId(newId => this.#registeredStreams.has(newId));

    const onData = (data: any) => {
      if (Buffer.isBuffer(data)) {
        socket.emit('r:sd', id, data);
      }
    }

    const cleanup = () => {
      this.#registeredStreams.delete(id);
      stream.off('data', onData);
    }

    stream.on('data', onData);

    stream.once('close', () => {
      cleanup();
      socket.emit('r:sc', id);
    });

    socket.once('disconnect', cleanup);

    this.#registeredStreams.set(id, stream);

    return [id, id ^ 0x1eafc0b7];
  }

  #registeredExposable = new Map<Socket, Map<string, Exposable<unknown>>>();

  #registerExposable(socket: Socket, exposed: Exposable<unknown>): [number, number] {
    if (!this.#registeredExposable.has(socket)) {
      this.#registeredExposable.set(socket, new Map());
    }

    const objects = this.#registeredExposable.get(socket)!;
    const id = this.#makeEphemeralId(newId => objects.has(`${exposed.$Kind}:${newId}`));
    objects.set(`${exposed.$Kind}:${id}`, exposed);

    this.register(exposed.$Kind as any, `${id}`, exposed as any, socket);

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
    const observers = this.#objectSocketObservers.get(socket)?.get(kind) ?? this.#objectGlobalObservers.get(kind)
    const object = observers?.get(id) as any;
    const observed = object instanceof ObjectObserver ? object : undefined;
    const instance = observed?.instance ?? object;
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
      } else if (typeof result === 'object') {
        const kind = result.$Kind;

        if (('$Exposing' in result) && kind) {
          resp = {
            status: 'exposed',
            kind,
            result: this.#registerExposable(socket, result)
          }
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

  // to be overriden
  protected async authenticateSocket(socket: Socket, username: string, password: string): Promise<ClientSocketData['user']> {
    return undefined;
  }

  async #handleAuth(socket: Socket, auth: AuthData) {
    const { nn, up } = auth;

    const down = up.map((e, ki) => Buffer.from(e.map((a,i) => 0xa5^a^nn[ki]^i)).toString());
    const user = await this.authenticateSocket(socket, down[0], down[1]);
    socket.data.user = user;

    if (user) {
      const session = getSocketSession(socket);
      session.auth = auth;
      session.save();
    }

    return user;
  }

  #handlers: Handlers = {
    'c:a': async (socket, nn, u, p, callback) => {
      const user = await this.#handleAuth(socket, { nn, up: [u, p] }).catch(stubFalse);
      this.#sendSession(socket);
      callback((
        user === false
        ? -100
        : user === undefined
          ? -1
          : 0
        ) as ClientAuthResult
      );
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
    },

    /**
     * Client requests to dispose a remote object created by them
     */
    'o:dis': async (socket, kind, id) => {
      this.#registeredExposable.get(socket)?.get(`${kind}:${id}`)?.dispose();
    }
  }

  register<Kind extends Extract<ConditionalKeys<Remote, object>, string>>(kind: Kind, id: string, o: Exposable<Remote[Kind]>, scopedWith?: Socket) {
    if (typeof o !== 'object') {
      return;
    }

    const objectObservers = (() => {
      if (scopedWith) {
        if (!this.#objectSocketObservers.has(scopedWith)) {
          this.#objectSocketObservers.set(scopedWith, new Map());
        }

        return this.#objectSocketObservers.get(scopedWith)!;
      }

      return this.#objectGlobalObservers;
    })();

    if (!objectObservers.has(kind)) {
      objectObservers.set(kind, new Map());
    }

    const observers = objectObservers.get(kind)!;
    const instance = o as unknown as object;

    if (observers.get(id)?.instance === instance) {
      // Already registered
      return;
    }

    this.deregister(kind, id, scopedWith);

    observers.set(id, new ObjectObserver(instance, async (instance, changes) => {
      if (scopedWith) {
        this.#notifySocketForPropertyChanges(scopedWith, kind, id, instance, changes);
        return;
      }

      for (const socket of this.io.sockets.sockets.values()) {
        this.#notifySocketForPropertyChanges(socket, kind, id, instance, changes);
      }
    }));
  }

  protected deregister<Kind extends Extract<ConditionalKeys<Remote, object>, string>>(kind: Kind, id: string, scopedWith?: Socket) {
    const objectObservers = (scopedWith ? this.#objectSocketObservers.get(scopedWith) : undefined) ?? this.#objectGlobalObservers;

    const observers = objectObservers.get(kind);
    if (!observers) {
      return;
    }

    if (!observers?.has(id)) {
      return;
    }

    const object = observers.get(id)!;

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

    observers.delete(id);

    if (observers.size <= 0) {
      objectObservers.delete(kind);
    }
  }

  async #notifySocketForPropertyChanges(socket: Socket, kind: string, id: string, instance: object, changes: ObservedPropertyChange<any>[]) {
    if (!await hasObjectGuardAccess(socket, instance)) {
      return;
    }

    const observation = this.#socketObservations.get(socket);

    if (!observation) {
      return;
    }

    const changesWithGuards = await Promise.all(changes.map(async change => ({
      change,
      allowed: await hasObjectGuardAccess(socket, instance, change.p)
    })));

    const filteredChanges = changesWithGuards.filter(({ allowed }) => allowed).map(({ change }) => change);

    if (filteredChanges.length) {
      const key = `${kind}:${id}` as `${string}:${string}`;
      const handler = observation.get(key);

      handler?.(instance, filteredChanges).catch((e) => {
        logger.error({ err: e, kind, id, key }, `Error notifying socket for property changes`);
      });
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

function isReservedProp(desc: TypedPropertyDescriptorOf) {
  if (desc.instance instanceof EventEmitter) {
    if (['domain'].includes(desc.name)) {
      return true;
    }
  }

  return false;
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
    this.#exposingProps = pickBy(exposing, desc => (desc.name in declared) && !(desc.name in this.#methods) && !isReservedProp(desc) && isPublicPropertyName(desc.name));
    this.#declaredProps = pickBy(declared, desc => !isReservedProp(desc) && isProperty(desc) && isPublicPropertyName(desc.name));

    // Properties that are only decalred at the exposed level but not at the exposing level
    const pureExpose = getPureExpose(instance);
    const wrappedProps = pickBy(this.#declaredProps, desc => desc?.set && (pureExpose.includes(desc.name) || !(desc.name in this.#exposingProps)));

    for (const [prop, desc] of Object.entries(wrappedProps)) {
      if (!desc) {
        continue;
      }

      this.#observeProperty(desc, (_, changes) => this.notify(instance, changes));
    }

    for (const [prop, desc] of Object.entries(this.#exposingProps)) {
      if (!desc) {
        continue;
      }

      this.#observeProperty(desc, (_, changes) => this.notify(instance, changes));
    }
  }

  #observeProperty(desc: TypedPropertyDescriptorOf, notify: (instance: object, changes: ObservedPropertyChange[]) => Promise<any>) {
    Object.defineProperty(desc.instance, desc.name, {
      get: () => desc.get ? desc.get.call(desc.instance) : desc.value,

      set: (v) => {
        const changes: ObservedPropertyChange[] = [];

        const dependents = getDependents(desc.instance, desc.name)
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

        if (typeof desc.name === 'string' && this.isPublishedProperty(desc.name) && !isEqual(old, v)) {
          changes.push({ p: desc.name, o: old, n: v });

          for (const [dep, oldValue] of dependents) {
            changes.push({
              p: dep.name,
              o: oldValue,
              n: dep.get ? dep.get.call(dep.instance) : dep.value
            })
          }

          notify(desc.instance, changes);
        }
      }
    })
  }

  #getExposing() {
    if ('$Exposing' in this.instance) {
      const exposed = (this.instance as any)['$Exposing'];

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
    return (name in this.#declaredProps) || (name in this.#exposingProps);
  }

  isPublishedMethod(name: string) {
    return name in this.#methods;
  }
}
