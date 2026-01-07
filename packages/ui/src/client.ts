import { isFunction, mapValues, noop, pickBy, random, uniqueId, } from "lodash";
import { EventEmitter } from "eventemitter3";
import { io, Socket } from "socket.io-client";
import msgpackParser from 'socket.io-msgpack-parser';
import { PassThrough } from 'readable-stream';
import { isProperty, waitFor } from "@seamless-medley/utils";

import type {
  ClientEvents as SocketClientEvents,
  ErrorResponse,
  RemoteResponse,
  ServerEvents,
  RemoteObserveOptions,
  AuthData,
  ObservedPropertyChange,
  PickMethod,
  PickProp,
  Remotable,
  ClientSessionData,
  ClientAuthResult
} from "@seamless-medley/remote";

import { type AudioTransportEvents } from "./audio/transport";
import { getRemoteTimeout, Stubs } from "./stubs";
import { getLogger } from "@logtape/logtape";

type Callable = (...args: any[]) => any;

type ParametersOf<T> = T extends (...args: infer A) => any ? A : never;

type ReturnTypeOf<T> = T extends (...args: any) => infer R ? R : never;

type ObserverHandler<Kind, T = any> = (kind: Kind, id: string, changes: ObservedPropertyChange<T>[]) => Promise<any>;

class ObservingStore<T extends object> {
  #observed: T = {} as T;

  #resolver: ((value: T) => void) | undefined;

  #rejector: ((reason?: any) => void) | undefined;

  #error?: RemoteError<any>;

  #pending: Promise<T> | undefined = new Promise<T>((resolve, reject) => {
    this.#resolver = resolve;
    this.#rejector = reject;
  })

  readonly handlers = new Set<ObserverHandler<any>>();

  constructor(readonly options?: RemoteObserveOptions) {

  }

  get observed() {
    return this.#observed;
  }

  set observed(value) {
    this.#observed = { ...value };
    this.#error = undefined;
    this.#resolver?.(this.#observed);
    this.#resolver = undefined;
    this.#rejector = undefined;
    this.#pending = undefined;
  }

  get error() {
    return this.#error;
  }

  reject(e: RemoteError<any>) {
    this.#observed = {} as T;
    this.#error = e;
    this.#rejector?.(e);
    this.#resolver = undefined;
    this.#rejector = undefined;
    this.#pending = undefined;
  }

  get pending() {
    return this.#pending;
  }

  add(handler: ObserverHandler<any>) {
    this.handlers.add(handler);
  }

  remove(handler: ObserverHandler<any>) {
    this.handlers.delete(handler);
  }

  get count() {
    return this.handlers.size;
  }
}

type ClientEvents = AudioTransportEvents & {
  connect(): void;
  disconnect(reason?: DisconnectReason): void;
  //
  start(): void;
  authResult(result: ClientAuthResult): void;
}

export enum DisconnectReason {
  ByClient,
  ByServer,
  Timeout,
  Transport,
  ParseError
}

type RejectAfterOptions = {
  timeout: number;
  reject: (reason?: any) => any;
  reason?: string;
}

function rejectAfter({ timeout, reject, reason = 'Timeout' }: RejectAfterOptions) {
  const ac = new AbortController();

  if (timeout > 0) {
    waitFor(timeout, ac.signal)
      .then(() => reject(reason))
      .catch(noop);
  }

  return () => ac.abort();
}

const $AnyProp: unique symbol = Symbol.for('$AnyProp');

const logger = getLogger('client');

export class Client<Types extends { [key: string]: any }, E extends {}> extends EventEmitter<E | ClientEvents> {
  protected socket!: Socket<ServerEvents, SocketClientEvents>;

  private delegates = new Map<`${string}:${string}`, { [event: string]: Set<Callable> | undefined }>();

  private observingStores = new Map<`${string}:${string}`, ObservingStore<any>>();

  private surrogates = new Map<string, Remotable<Types[any]>>();

  protected authData?: AuthData;

  protected sessionData?: ClientSessionData;

  /**
   * Latency in seconds
   */
  protected _latency = 0;

  constructor() {
    super();

    this.socket = io({
      transports: ['websocket'],
      parser: msgpackParser
    });

    this.socket.on('s:p', this.handleServerPing);
    this.socket.on('c:l', this.handleLatencyReport);
    this.socket.on('c:s', this.handleSessionResponse);
    this.socket.on('r:e', this.handleRemoteEvent);
    this.socket.on('r:u', this.handleRemoteUpdate);
    this.socket.on('r:sd', this.handleRemoteStreamData);
    this.socket.on('r:sc', this.handleRemoteStreamClose);

    this.socket.on('connect', () => this.handleSocketConnect());
    this.socket.on('disconnect', this.handleSocketDisconnect);
    this.socket.io.on('reconnect', this.handleSocketReconnect);
  }

  private handleServerPing: ServerEvents['s:p'] = async (serverTime, callback) => {
    callback(serverTime);
  }

  private handleLatencyReport: ServerEvents['c:l'] = async (latencyMs) => {
    this.latency = latencyMs / 1000;
  }

  private handleSessionResponse: ServerEvents['c:s'] = async (sessionData) => {
    logger.debug('SESSION RESP {*}', { sessionData });
    this.sessionData = sessionData;
    this.startSession();
  }

  private handleRemoteEvent: ServerEvents['r:e'] = (kind, id, event, ...args) => {
    const delegates = this.getDelegateFor(kind, id, event);

    if (delegates) {
      for (const delegate of delegates.values()) {
        delegate(...args);
      }
    }
  }

  private handleRemoteUpdate: ServerEvents['r:u'] = (kind, id, changes) => {
    const store = this.observingStores.get(`${kind}:${id}`);
    if (store) {
      for (const { p: prop, o: oldValue, n: newValue } of changes) {
        store.observed[prop] = newValue;
      }

      for (const handler of store.handlers.values()) {
        handler(kind, id, changes);
      }
    }
  }

  private handleRemoteStreamData: ServerEvents['r:sd'] = (id, data) => {
    const stream = this.localStreams.get(id);

    if (!stream) {
      return false;
    }

    stream.push(new Uint8Array(data));
    return true;
  }

  private handleRemoteStreamClose: ServerEvents['r:sc'] = (id) => {
    if (!this.localStreams.has(id)) {
      return false;
    }

    this.localStreams.get(id)?.destroy();
    this.localStreams.delete(id);
    return true;
  }

  private handleSocketReconnect = (attempt: number) => {
    logger.debug('RE-CONNECT');

    for (const [key, events] of this.delegates) {
      const [kind, id] = this.extractId(key);

      for (const event of Object.keys(events)) {
        this.socket.emit('r:es', kind, id, event, async (response) => {
          if (response.status !== undefined) {
            // Error resubscribing to event, remove it
            delete events[event];

            if (Object.keys(events).length === 0) {
              this.delegates.delete(key);
            }
          }
        })
      }
    }

    this.#restoreObservingStores();
  }

  get latency() {
    return this._latency;
  }

  set latency(seconds: number) {
    this._latency = seconds;
  }

  async #restoreObservingStores(pred: (kind: string, id: string, store: ObservingStore<any>) => boolean = () => true) {
    const restorations = [...this.observingStores]
      .map(([key, store]) => {
        const [kind, id] = this.extractId(key);
        return [kind, id, store] as const;
      })
      .filter(p => pred(...p))
      .map(([kind, id, store]) => new Promise<void>((resolve) => {
        logger.debug('Restoring {*}', { kind, id });

        this.socket.emit('r:ob', kind, id, store.options, async (response) => {
          if (response.status === undefined) {
            store.observed = response.result;

            if (response.result) {
              const changes = Object.entries(response.result).map<ObservedPropertyChange>(([prop, value]) => ({
                p: prop,
                o: value,
                n: value
              }));

              for (const handler of store.handlers) {
                handler(kind, id, changes);
              }
            }

            resolve();
            return;
          }

          if (response.status === 'stream') {
            response = {
              status: 'exception',
              message: 'Remote property of type stream is not supported'
            }
          }

          if (response.status === 'exposed') {
            response = {
              status: 'exception',
              message: 'Remote property of type exposed is not supported'
            }
          }

          store.reject(new RemoteObservationError(response, kind, id));
          resolve();
        });
      }));

    await Promise.all(restorations);
  }

  protected async handleSocketConnect() {
    this.emit('connect');
  }

  private handleSocketDisconnect = (reason: Socket.DisconnectReason) => {
    this.sessionData = undefined;

    const reasonMap: Partial<Record<Socket.DisconnectReason, DisconnectReason>> = {
      'io client disconnect': DisconnectReason.ByClient,
      'io server disconnect': DisconnectReason.ByServer,
      'ping timeout': DisconnectReason.Timeout,
      'transport close': DisconnectReason.Transport,
      'transport error': DisconnectReason.Transport,
      'parse error': DisconnectReason.ParseError
    };

    this.emit('disconnect', reasonMap[reason]);
  }

  protected async startSession() {
    await this.#restoreObservingStores((kind, id, store) => store.error?.errorType !== 'prohibited');

    this.emit('start');
  }

  get session() {
    return this.sessionData;
  }

  private extractId(key: `${string}:${string}`) {
    return key.split(':', 2);
  }

  dispose() {
    if (this.connected) {
      for (const [key, events] of [...this.delegates]) {
        const [ns, id] = this.extractId(key);

        for (const [event, delegates] of Object.entries(events)) {
          if (delegates) {
            for (const delegate of delegates?.values()) {
              this.remoteUnsubscribe(ns, id, event, delegate);
            }
          }
        }
      }
    }

    this.delegates.clear();
    this.observingStores.clear();

    this.surrogateCache.clear();
    this.surrogateRefCounters.clear();

    for (const surrogate of this.surrogates.values()) {
      try {
        (surrogate as any).dispose();
      }
      catch {

      }
    }

    this.surrogates.clear();
  }

  get connected() {
    return this.socket.connected;
  }

  authenticate(username: string, password: string) {
    const e = new TextEncoder();

    this.authData = (({ nn, f }) => ({ up: [f(username, nn[0]), f(password, nn[1])], nn: nn.map(n => 0xa5^n) }))(
      { nn: Array(2).fill(undefined).map(() => random(1, 255)), f: (s:string,n: number) => Array.from(e.encode(s).map((s, i) => s^i^n)) }
    );

    const { nn, up: [u, p] } = this.authData;

    this.socket.emit('c:a', nn, u, p, this.handleAuthResult);
  }

  private handleAuthResult = (result: ClientAuthResult) => {
    this.emit('authResult', result);
  }

  private getDelegateEvents(ns: string, id: string) {
    const key = `${ns}:${id}` as const;

    if (!this.delegates.has(key)) {
      this.delegates.set(key, {});
    }

    return this.delegates.get(key)!;
  }

  private getDelegateFor(kind: string, id: string, event: string) {
    const events = this.getDelegateEvents(kind, id);
    const hasSet = events[event] !== undefined;
    return hasSet ? events[event]! : (() => events[event] = new Set<Callable>())();
  }

  private localStreams = new Map<number, PassThrough>();

  private createLocalStream(id: number) {
    if (this.localStreams.has(id)) {
      return false;
    }

    const result = new PassThrough();
    this.localStreams.set(id, result);
    return result;
  }

  remoteGet<
    Kind extends Extract<keyof Types, string>,
    P extends keyof O,
    O = PickProp<Types[Kind]>
  >(
    kind: Kind,
    id: string,
    timeout: number,
    prop: P
  ): Promise<O[P]> {
    return new Promise<O[P]>((resolve, reject) => {
      const abortTimeout = rejectAfter({ timeout, reject });

      this.socket.emit('r:pg', kind, id, prop as string, async (response: RemoteResponse<any>) => {
        abortTimeout();

        if (response.status === undefined) {
          resolve(response.result);
          return;
        }

        if (response.status === 'stream') {
          response = {
            status: 'exception',
            message: 'Remote property of type stream is not supported'
          }
        }

        if (response.status === 'exposed') {
          response = {
            status: 'exception',
            message: 'Remote property of type exposed is not supported'
          }
        }

        reject(new RemotePropertyError(response, kind, id, prop as string, 'get'));
      });
    });
  }

  remoteSet<
    Kind extends Extract<keyof Types, string>,
    P extends keyof O,
    O = PickProp<Types[Kind]>
  >(
    kind: Kind,
    id: string,
    timeout: number,
    prop: P,
    value: O[P]
  ) {
    return new Promise<any>((resolve, reject) => {
      const abortTimeout = rejectAfter({ timeout, reject });

      this.socket.emit('r:ps', kind, id, prop as string, value, async (response: RemoteResponse<any>) => {
        abortTimeout();

        if (response.status === undefined) {
          resolve(response.result);
          return;
        }

        if (response.status === 'stream') {
          response = {
            status: 'exception',
            message: 'Remote property of type stream is not supported'
          }
        }

        if (response.status === 'exposed') {
          response = {
            status: 'exception',
            message: 'Remote property of type exposed is not supported'
          }
        }

        reject(new RemotePropertyError(response, kind, id, prop as string, 'set'));
      })
    });
  }

  remoteInvoke<
    Kind extends Extract<keyof Types, string>,
    N extends keyof M,
    M = PickMethod<Types[Kind]>
  >(
    kind: Kind,
    id: string,
    timeout: number,
    method: N,
    ...args: ParametersOf<M[N]>
  ) {
    return new Promise((resolve, reject) => {
      const abortTimeout = rejectAfter({ timeout, reject });

      this.socket.emit('r:mi', kind, id, method as string, args, async (response: RemoteResponse<ReturnTypeOf<M[N]>>) => {
        abortTimeout();

        if (response.status === undefined) {
          resolve(response.result);
          return;
        }

        if (response.status === 'stream') {
          const [id1, id2] = response.result;

          if ((id1 ^ id2) === 0x1eafc0b7) {
            const stream = this.createLocalStream(id1);

            if (stream !== false) {
              resolve(stream);
              return;
            }

            response = {
              status: 'exception',
              message: 'The stream returned by the remote invocation is already exist'
            }
          } else {
            response = {
              status: 'exception',
              message: 'The stream returned by the remote invocation is invalid'
            }
          }
        }

        if (response.status === 'exposed') {
          const [exposedId, id2] = response.result;

          if ((exposedId ^ id2) === 0x1eafc0b7) {
            const kind = response.kind as any;

            const result = await this.surrogateOf(kind, `${exposedId}`).catch(error => {
              logger.error('Error calling `surrogateOf` on {*}', { kind, id, exposedId, error });
            });

            if (result) {
              result.addDisposeListener(async () => this.socket.emit('o:dis', kind, `${exposedId}`));
              resolve(result);
              return;
            }

            response = {
              status: 'exception',
              message: 'Could not retrieve remote object information'
            }
          }

          response = {
            status: 'exception',
            message: 'The exposed object returned by the remote invocation is invalid'
          }
        }

        reject(new RemoteInvocationError(response, kind, id, method as string));
      })
    })
  }

  private remoteSubscribe(kind: string, id: string, event: string, delegate: Callable) {
    return new Promise<void>((resolve, reject) => {
      const deletgates = this.getDelegateFor(kind, id, event);

      // Already subscribed
      if (deletgates.has(delegate)) {
        resolve();
        return;
      }

      // Already subscribed to remote, simply add it
      if (deletgates.size > 0) {
        deletgates.add(delegate);
        resolve();
        return;
      }

      const abortTimeout = rejectAfter({ timeout: 5_000, reject });

      // It is the first time, subscribe to remote first
      this.socket.emit('r:es', kind, id, event, async (response: RemoteResponse<void>) => {
        abortTimeout();

        if (response.status === undefined) {
          deletgates.add(delegate);
          resolve();
          return;
        }

        if (response.status === 'stream') {
          response = {
            status: 'exception',
            message: 'Remote subscription of type stream is not possible'
          }
        }

        if (response.status === 'exposed') {
          response = {
            status: 'exception',
            message: 'Remote subscription of type exposed is not possible'
          }
        }

        reject(new RemoteSubscriptionError(response, kind, id, event));
      });
    });
  }

  private remoteUnsubscribe(kind: string, id: string, event: string, delegate: Callable) {
    return new Promise<void>((resolve, reject) => {
      const events = this.getDelegateEvents(kind, id);
      const delegates = events[event];

      if (!delegates) {
        resolve();
        return;
      }

      delegates.delete(delegate);

      if (delegates.size > 0) {
        // Still has some subscribers
        resolve();
        return;
      }

      // No subscribers left for this event

      delete events[event];

      if (Object.keys(events).length === 0) {
        this.delegates.delete(`${kind}:${id}`);
      }

      const abortTimeout = rejectAfter({ timeout: 5_000, reject });

      this.socket.emit('r:eu', kind, id, event, async (response: RemoteResponse<void>) => {
        abortTimeout();

        if (response.status === undefined) {
          resolve();
          return;
        }

        if (response.status === 'stream') {
          response = {
            status: 'exception',
            message: 'Remote subscription of type stream is not possible'
          }
        }

        if (response.status === 'exposed') {
          response = {
            status: 'exception',
            message: 'Remote subscription of type exposed is not possible'
          }
        }

        reject(new RemoteSubscriptionError(response, kind, id, event));
      })
    });
  }

  remoteObserve<Kind extends Extract<keyof Types, string>>(kind: Kind, id: string, options: RemoteObserveOptions | undefined, handler: ObserverHandler<Kind>) {
    return new Promise<Types[Kind]>(async (resolve, reject) => {
      const key = `${kind}:${id}` as const;

      if (this.observingStores.has(key)) {
        const store = this.observingStores.get(key)!;
        store.add(handler);

        await store.pending;

        if (store.error === undefined) {
          resolve(store.observed)
        } else {
          reject(store.error);
        }

        return;
      }

      const store = new ObservingStore<Types[Kind]>(options);
      this.observingStores.set(key, store);

      const abortTimeout = rejectAfter({
        timeout: 5_000,
        reject: () => {
          const error = new RemoteObservationError({ status: 'exception', message: 'Timeout' }, kind, id);
          store.reject(error);
          reject(error);
        }
      })

      this.socket.emit('r:ob', kind, id, options, async (response: RemoteResponse<any>) => {
        abortTimeout();

        store.add(handler);

        if (response.status === undefined) {
          store.observed = response.result;

          resolve(store.observed);
          return;
        }

        if (response.status === 'stream') {
          response = {
            status: 'exception',
            message: 'Remote observation of type stream is not supported'
          }
        }

        if (response.status === 'exposed') {
          response = {
            status: 'exception',
            message: 'Remote observation of type exposed is not supported'
          }
        }

        const error = new RemoteObservationError(response, kind, id);
        store.reject(error);
        reject(error);
      });

      store.pending?.then(resolve, reject);
    });
  }

  remoteUnobserve<Kind extends Extract<keyof Types, string>>(kind: Kind, id: string, handler: ObserverHandler<Kind>) {
    return new Promise<void>((resolve, reject) => {
      const key = `${kind}:${id}` as const;

      if (!this.observingStores.has(key)) {
        resolve();
        return;
      }

      const store = this.observingStores.get(key)!;
      store.remove(handler);

      if (store.count > 0) {
        resolve();
        return;
      }

      this.observingStores.delete(key);

      const abortTimeout = rejectAfter({ timeout: 5_000, reject });

      this.socket.emit('r:ub', kind, id, async (response) => {
        abortTimeout();

        if (response.status === undefined) {
          resolve();
          return;
        }

        if (response.status === 'stream') {
          response = {
            status: 'exception',
            message: 'Remote observation of type stream is not supported'
          }
        }

        if (response.status === 'exposed') {
          response = {
            status: 'exception',
            message: 'Remote observation of type exposed is not supported'
          }
        }

        reject(new RemoteObservationError(response, kind, id));
      });
    });
  }

  private surrogateCache = new Map<string, WeakRef<Remotable<object>>>();

  private surrogateRefCounters = new Map<string, number>();

  private surrogateRegistry = new FinalizationRegistry<string>((objectId) => {
    if (!this.surrogateCache.get(objectId)?.deref()) {
      this.surrogateCache.delete(objectId);
      this.surrogateRefCounters.delete(objectId);
    }
  });

  /**
   * Return a virtual object that acts as a surrogate of a remote object
   */
  async surrogateOf<
    Kind extends Extract<keyof Types, string>,
  >(
    kind: Kind,
    id: string,
    observeOptions?: Omit<RemoteObserveOptions, 'excludes'>
  ): Promise<Remotable<Types[Kind]>> {
    const objectId = `${kind}:${id}` as const;

    if (this.surrogateCache.has(objectId)) {
      this.surrogateRefCounters.set(
        objectId,
        (this.surrogateRefCounters.get(objectId) ?? 0) + 1
      );

      return this.surrogateCache.get(objectId)!.deref() as Remotable<Types[Kind]>;
    }

    const uuid = uniqueId(`surrogate:${objectId}--`);

    const StubClass = Stubs[kind];

    const { descriptors } = StubClass;
    const mergedDescs = { ...descriptors.own, ...descriptors.proto };

    const propertyDescs = pickBy(mergedDescs, isProperty);
    const methodDescs = pickBy(mergedDescs, desc => isFunction(desc.value));

    const propertyChangeHandlers = new Map<string | typeof $AnyProp, Set<(newValue: any, oldValue: any, prop: string) => Promise<any>>>();

    const propertyObserver: ObserverHandler<Kind> = async (kind, id, changes) => {

      const anyPropHandlers = propertyChangeHandlers.get($AnyProp);

      for (const { p: prop, o: oldValue, n: newValue } of changes) {
        const propHandlers = propertyChangeHandlers.get(prop);

        const allHandlers = [];

        if (anyPropHandlers) {
          allHandlers.push(...anyPropHandlers);
        }

        if (propHandlers) {
          allHandlers.push(...propHandlers);
        }

        if (!allHandlers.length) {
          continue;
        }

        for (const handler of allHandlers) {
          handler(newValue, oldValue, prop);
        }
      }
    }

    const addPropertyChangeListener = (propKey: string | typeof $AnyProp, handler: (newValue: any, oldValue: any, prop: string) => any) => {
      if (!propertyChangeHandlers.has(propKey)) {
        propertyChangeHandlers.set(propKey, new Set());
      }

      const handlers = propertyChangeHandlers.get(propKey)!;
      handlers.add(handler);

      return () => void handlers.delete(handler);
    }

    const onDisposeHandlers = new Set<() => Promise<any>>();

    const addDisposeListener = (handler: () => Promise<any>) => {
      onDisposeHandlers.add(handler);
    }

    await this.remoteObserve(kind, id, observeOptions, propertyObserver);

    const getObservedFromStore = () => {
      const store = this.observingStores.get(objectId);
      return (store?.observed ?? {}) as Types[Kind];
    }

    const subscriptionHandlers = new Map<string, Set<Callable>>;

    const on = (event: string, handler: Callable) => {
      this.remoteSubscribe(kind, id, event, handler);

      if (!subscriptionHandlers.has(event)) {
        subscriptionHandlers.set(event, new Set());
      }

      subscriptionHandlers.get(event)!.add(handler);
    }

    const off = (event: string, handler: Callable) => {
      this.remoteUnsubscribe(kind, id, event, handler).catch(noop);

      if (subscriptionHandlers.has(event)) {
        const handlers = subscriptionHandlers.get(event)!;

        handlers.delete(handler);

        if (handlers.size <= 0) {
          subscriptionHandlers.delete(event);
        }
      }
    }

    const emitterMethods = { on, off };

    const getTimeout = (prop?: string) => Math.max(0, getRemoteTimeout(StubClass.StubbedFrom, prop) ?? 60_000);

    const getProperty = async (prop: string) => {
      const value = await this.remoteGet(kind, id, getTimeout(), prop as any);
      getObservedFromStore()[prop] = value;
      return value;
    }

    const getProperties = getObservedFromStore;

    const propertyGetters = mapValues(propertyDescs, (desc, name) => (...args: any[]) => {

      if (args.length === 0) {
        return getProperties()[name];
      }

      return new Promise(async (resolve, reject) => {
        await this.remoteSet(kind, id, getTimeout(name), name as any, args[0]).then(resolve).catch(reject);
        return;
      })
    });

    const methods = mapValues(methodDescs, (desc, name) => (...args: any[]) => {
      if (desc.value !== noop) {
        // The method is implemented at client-side, no need to remotely invoke it on the server
        (desc.value as Function).apply(surrogate, args);
        return;
      }

      return this.remoteInvoke(kind, id, getTimeout(name), name as any, ...args as any);
    });

    const dispose = async () => {
      const refCount = (this.surrogateRefCounters.get(objectId) ?? 0) - 1;

      if (refCount > 0) {
        return;
      }

      if (this.socket.connected) {
        this.remoteUnobserve(kind, id, propertyObserver).catch(noop);
      }

      for (const [event, handlers] of [...subscriptionHandlers]) {
        for (const handler of handlers) {
          off(event, handler);
        }
      }

      subscriptionHandlers.clear();

      for (const handler of onDisposeHandlers.values()) {
        handler();
      }

      onDisposeHandlers.clear();

      this.surrogates.delete(uuid);
      this.surrogateCache.delete(objectId);
      this.surrogateRefCounters.delete(objectId);
    }

    const specialMethods: Record<string | symbol, any> = {
      dispose,
      getProperty,
      getProperties,
      addPropertyChangeListener,
      addDisposeListener
    }

    const surrogate = new Proxy({ uuid } as {}, {
      get(target, prop) {
        if (prop in specialMethods) {
          return specialMethods[prop];
        }

        if (prop in emitterMethods) {
          return emitterMethods[prop as keyof typeof emitterMethods];
        }

        if (prop in propertyGetters) {
          return propertyGetters[prop as keyof typeof propertyGetters];
        }

        if (prop in methodDescs) {
          return methods[prop as keyof typeof methods];
        }
      }
    }) as Remotable<Types[any]>;

    this.surrogates.set(uuid, surrogate);
    this.surrogateCache.set(objectId, new WeakRef(surrogate));
    this.surrogateRefCounters.set(objectId, 1);
    this.surrogateRegistry.register(surrogate, objectId);

    return surrogate as unknown as Remotable<Types[Kind]>;
  }
}

export abstract class RemoteError<Kind> {
  readonly errorType: ErrorResponse['status'];
  readonly message?: string;

  constructor(response: ErrorResponse, readonly kind: Kind, readonly id: string) {
    this.errorType = response.status;

    if (response.status === 'exception') {
      this.message = response.message;
    }
  }
}

export class RemotePropertyError<Kind> extends RemoteError<Kind> {
  constructor(response: ErrorResponse, kind: Kind, id: string, readonly prop: string, readonly direction: 'get' | 'set') {
    super(response, kind, id);
  }
}

export class RemoteInvocationError<Kind> extends RemoteError<Kind> {
  constructor(response: ErrorResponse, kind: Kind, id: string, readonly method: string) {
    super(response, kind, id);
  }
}

export class RemoteSubscriptionError<Kind> extends RemoteError<Kind> {
  constructor(response: ErrorResponse, kind: Kind, id: string, readonly event: string) {
    super(response, kind, id);
  }
}

export class RemoteObservationError<Kind> extends RemoteError<Kind> {

}
