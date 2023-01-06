import { isFunction, mapValues, pickBy, uniqueId, } from "lodash";
import { EventEmitter } from "eventemitter3";
import { io, Socket } from "socket.io-client";
import { ClientEvents as SocketClientEvents, ErrorResponse, RemoteResponse, ServerEvents } from '../socket/events';
import { isProperty } from "../socket/remote/utils";
import { Stub } from "../socket/stub";
import { $AnyProp, AnyProp, PickMethod, PickProp, Remotable } from "../socket/types";
import { Callable, ParametersOf } from "../types";
import { DisconnectDescription } from "socket.io-client/build/esm/socket";

type ObserverHandler<Kind, T = any> = (kind: Kind, id: string, prop: string, oldValue: T, newValue: T) => Promise<any>;

class ObservingStore<T extends object> {
  private _observed: T = {} as T;

  private resolver: ((value: T) => void) | undefined;

  private _pending: Promise<T> | undefined = new Promise<T>((resolve) => {
    this.resolver = resolve;
  })

  readonly handlers = new Set<ObserverHandler<any>>();

  get observed() {
    return this._observed;
  }

  set observed(value) {
    this._observed = { ...value };
    this.resolver?.(this._observed);
    this.resolver = undefined;
    this._pending = undefined;
  }

  get pending() {
    return this._pending;
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

type ClientEvents = {
  connect(): void;
  disconnect(reason?: DisconnectReason): void;
}

export enum DisconnectReason {
  // "io server disconnect" | "io client disconnect" | "ping timeout" | "transport close" | "transport error"
  ByClient,
  ByServer,
  Timeout,
  Transport
}

export class Client<Types extends { [key: string]: any }> extends EventEmitter<ClientEvents> {
  private socket: Socket<ServerEvents, SocketClientEvents>;

  private delegates = new Map<`${string}:${string}`, { [event: string]: Set<Callable> | undefined }>();

  private observingStores = new Map<`${string}:${string}`, ObservingStore<any>>();

  private surrogates = new Map<string, Remotable<Types[any]>>();

  constructor() {
    super();

    this.socket = io({ transports: ['websocket'] });
    this.socket.on('remote:event', this.handleRemoteEvent);
    this.socket.on('remote:update', this.handleRemoteUpdate);
    this.socket.io.on('reconnect', this.handleSocketReconnect);

    this.socket.on('connect', this.handleSocketConnect);
    this.socket.on('disconnect', this.handleSocketDisconnect);
  }

  private handleRemoteEvent: ServerEvents['remote:event'] = (kind, id, event, ...args) => {
    const delegates = this.getDelegateFor(kind, id, event);

    if (delegates) {
      for (const delegate of delegates.values()) {
        delegate(...args);
      }
    }
  }

  private handleRemoteUpdate: ServerEvents['remote:update'] = (kind, id, prop, oldValue, newValue) => {
    const store = this.observingStores.get(`${kind}:${id}`);
    if (store) {
      store.observed[prop] = newValue;

      for (const handler of store.handlers.values()) {
        handler(kind, id, prop, oldValue, newValue);
      }
    }
  }

  private handleSocketReconnect = (attempt: number) => {
    for (const [key, events] of this.delegates) {
      const [kind, id] = this.extractId(key);

      for (const event of Object.keys(events)) {
        this.socket.emit('remote:subscribe', kind, id, event, async (response) => {
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

    for (const [key, store] of [...this.observingStores]) {
      const [kind, id] = this.extractId(key);

      this.socket.emit('remote:observe', kind, id, async (response) => {
        if (response.status !== undefined) {
          // Error reobserving
          return;
        }

        store.observed = response.result;

        for (const handler of store.handlers) {
          for (const [prop, value] of Object.entries(response.result)) {
            handler(kind, id, prop, value, value);
          }
        }
      });
    }
  }

  private handleSocketConnect = () => {
    this.emit('connect');
  }

  private handleSocketDisconnect = (reason: Socket.DisconnectReason, description?: DisconnectDescription) => {
    const reasonMap: Record<Socket.DisconnectReason, DisconnectReason> = {
      'io client disconnect': DisconnectReason.ByClient,
      'io server disconnect': DisconnectReason.ByServer,
      'ping timeout': DisconnectReason.Timeout,
      'transport close': DisconnectReason.Transport,
      'transport error': DisconnectReason.Transport
    };

    this.emit('disconnect', reasonMap[reason]);
  }

  private extractId(key: `${string}:${string}`) {
    return key.split(':', 2);
  }

  dispose() {
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

    this.delegates.clear();
    this.observingStores.clear();

    for (const surrogate of this.surrogates.values()) {
      surrogate.dispose();
    }

    this.surrogates.clear();

    this.socket.close();
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
    const hasSet = !!events[event];
    return hasSet ? events[event]! : (() => events[event] = new Set<Callable>())();
  }

  remoteGet<
    Kind extends Extract<keyof Types, string>,
    P extends keyof O,
    O = PickProp<Types[Kind]>
  >(
    kind: Kind,
    id: string,
    prop: P
  ) {
    return new Promise<any>((resolve, reject) => {
      this.socket.emit('remote:get', kind, id, prop as string, async (response: RemoteResponse<any>) => {
        if (response.status === undefined) {
          resolve(response.result);
          return;
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
    prop: P,
    value: O[P]
  ) {
    return new Promise<any>((resolve, reject) => {
      this.socket.emit('remote:set', kind, id, prop as string, value, async (response: RemoteResponse<any>) => {
        if (response.status === undefined) {
          resolve(response.result);
          return;
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
    method: N,
    ...args: ParametersOf<M[N]>
  ) {
    return new Promise<any>((resolve, reject) => {
      this.socket.emit('remote:invoke', kind, id, method as string, args, async (response: RemoteResponse<any>) => {
        if (response.status === undefined) {
          resolve(response.result);
          return;
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

      // It is the first time, subscrbe to remote first
      this.socket.emit('remote:subscribe', kind, id, event, async (response: RemoteResponse<void>) => {
        if (response.status !== undefined) {
          reject(new RemoteSubscriptionError(response, kind, id, event));
          return;
        }

        deletgates.add(delegate);
        resolve(response.result);
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

      this.socket.emit('remote:unsubscribe', kind, id, event, async (response: RemoteResponse<void>) => {
        if (response.status !== undefined) {
          reject(new RemoteSubscriptionError(response, kind, id, event));
          return;
        }

        resolve();
      })
    });
  }

  private remoteObserve<Kind extends Extract<keyof Types, string>>(kind: Kind, id: string, handler: ObserverHandler<Kind>) {
    return new Promise<Types[Kind]>(async (resolve, reject) => {
      const key = `${kind}:${id}` as const;

      if (this.observingStores.has(key)) {
        const store = this.observingStores.get(key)!;
        store.add(handler);

        await store.pending;
        resolve(store.observed);

        return;
      }

      const store = new ObservingStore<Types[Kind]>();
      this.observingStores.set(key, store);

      this.socket.emit('remote:observe', kind, id, async (response: RemoteResponse<any>) => {
        if (response.status !== undefined) {
          reject(new RemoteObservationError(response, kind, id));
          return;
        }

        store.observed = response.result;
        store.add(handler);

        resolve(store.observed);
      });
    });
  }

  private remoteUnobserve<Kind extends Extract<keyof Types, string>>(kind: Kind, id: string, handler: ObserverHandler<Kind>) {
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

      this.socket.emit('remote:unobserve', kind, id, async (response) => {
        if (response.status === undefined) {
          resolve();
          return;
        }

        reject(new RemoteObservationError(response, kind, id));
      });
    });
  }

  /**
   * Return a virtual object that acts as a surrogate of a remote object
   */
  async surrogateOf<
    Kind extends Extract<keyof Types, string>,
  >(
    StubClass: Stub<Types[Kind]>,
    kind: Kind,
    id: string
  ) {
    const uuid = uniqueId(`surrogate:${kind}:${id}`);

    const { descriptors } = StubClass;
    const mergedDescs = { ...descriptors.own, ...descriptors.proto };

    const propertyDescs = pickBy(mergedDescs, isProperty);
    const methodDescs = pickBy(mergedDescs, desc => isFunction(desc.value));

    const propertyChangeHandlers = new Map<string | AnyProp, Set<(newValue: any, oldValue: any) => Promise<any>>>();

    const propertyObserver: ObserverHandler<Kind> = async (kind, id, prop, oldValue, newValue) => {
      const anyPropHandlers = propertyChangeHandlers.get($AnyProp);

      const propHandlers = propertyChangeHandlers.get(prop);

      const allHandlers = [];

      if (anyPropHandlers) {
        allHandlers.push(...anyPropHandlers);
      }

      if (propHandlers) {
        allHandlers.push(...propHandlers);
      }

      if (!allHandlers.length) {
        return;
      }

      for (const handler of allHandlers) {
        handler(newValue, oldValue);
      }
    }

    const addPropertyChangeHandler = (propKey: string | AnyProp, handler: (oldValue: any, newValue: any) => any) => {
      if (!propertyChangeHandlers.has(propKey)) {
        propertyChangeHandlers.set(propKey, new Set());
      }

      const handlers = propertyChangeHandlers.get(propKey)!;
      handlers.add(handler);

      return () => void handlers.delete(handler);
    }

    const onDisposeHandlers = new Set<() => Promise<any>>();

    const addDisposeHandler = (handler: () => Promise<any>) => {
      onDisposeHandlers.add(handler);
    }

    await this.remoteObserve(kind, id, propertyObserver);

    const getObservedFromStore = () => {
      const key = `${kind}:${id}` as const;
      const store = this.observingStores.get(key);
      return store?.observed ?? {} as Types[Kind];
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
      this.remoteUnsubscribe(kind, id, event, handler);

      if (subscriptionHandlers.has(event)) {
        const handlers = subscriptionHandlers.get(event)!;

        handlers.delete(handler);

        if (handlers.size <= 0) {
          subscriptionHandlers.delete(event);
        }
      }
    }

    const emitterMethods = { on, off };

    const getProperties = () => getObservedFromStore();

    const propertyGetters = mapValues(propertyDescs, (desc, name) => (...args: any[]) => {
      if (args.length === 0) {
        return getProperties()[name];
      }

      return new Promise(async (resolve, reject) => {
        await this.remoteSet(kind, id, name as any, args[0]).then(resolve).catch(reject);
        return;
      })
    });

    const methods = mapValues(methodDescs, (desc, name) => (...args: any[]) => this.remoteInvoke(kind, id, name as any, ...args as any));

    const dispose = async () => {
      this.remoteUnobserve(kind, id, propertyObserver);

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
    }

    const specialMethods: Record<string | symbol, any> = {
      dispose,
      getProperties,
      onPropertyChange: addPropertyChangeHandler,
      onDispose: addDisposeHandler,
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
    }) as Remotable<Types[Kind]>;

    this.surrogates.set(uuid, surrogate);

    return surrogate;
  }
}

abstract class RemoteError<Kind> {
  readonly errorType: string;
  readonly message?: string;

  constructor(response: ErrorResponse, readonly kind: Kind, readonly id: string) {
    this.errorType = response.status;

    if (response.status === 'exception') {
      this.message = response.message;
    }
  }
}

class RemotePropertyError<Kind> extends RemoteError<Kind> {
  constructor(response: ErrorResponse, kind: Kind, id: string, readonly prop: string, readonly direction: 'get' | 'set') {
    super(response, kind, id);
  }
}

class RemoteInvocationError<Kind> extends RemoteError<Kind> {
  constructor(response: ErrorResponse, kind: Kind, id: string, readonly method: string) {
    super(response, kind, id);
  }
}

class RemoteSubscriptionError<Kind> extends RemoteError<Kind> {
  constructor(response: ErrorResponse, kind: Kind, id: string, readonly event: string) {
    super(response, kind, id);
  }
}

class RemoteObservationError<Kind> extends RemoteError<Kind> {

}
