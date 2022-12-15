import { isFunction, mapValues, pickBy, uniqueId, } from "lodash";
import { io, Socket } from "socket.io-client";
import { ClientEvents, RemoteErrorStatus, RemoteResponse, ServerEvents } from '../socket/events';
import { isProperty } from "../socket/remote";
import { Stub } from "../socket/stub";
import { Remotable } from "../socket/types";
import { AsyncFunctionOf, Callable } from "../types";

type ObserverHandler<NS, T = any> = (ns: NS, id: string, prop: string, oldValue: T, newValue: T) => Promise<any>;

class ObservingStore<T extends object> {
  private _observed: T = {} as T;

  readonly handlers = new Set<ObserverHandler<any>>();

  get observed() {
    return this._observed;
  }

  set observed(value) {
    this._observed = { ...value };
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

const $AnyProp: unique symbol = Symbol.for('$AnyProp');
type AnyProp = typeof $AnyProp;

type SurrogateInfo = {
  disposers: Set<AsyncFunctionOf<Callable>>;
}

export class Client<Types extends { [key: string]: any }> {
  private socket: Socket<ServerEvents, ClientEvents>;

  private delegates = new Map<`${string}:${string}`, { [event: string]: Set<Callable> | undefined }>();

  private observingStores = new Map<`${string}:${string}`, ObservingStore<any>>();

  private surrogateInfo: SurrogateInfo = {
    disposers: new Set()
  }

  constructor() {
    this.socket = io({ transports: ['websocket'] });
    this.socket.on('remote:event', this.handleRemoteEvent);
    this.socket.on('remote:update', this.handleRemoteUpdate);
    this.socket.io.on('reconnect', this.handleSocketReconnect);
  }

  private handleRemoteEvent: ServerEvents['remote:event'] = (ns, id, event, ...args) => {
    const delegates = this.getDelegateFor(ns, id, event);

    if (delegates) {
      for (const delegate of delegates.values()) {
        delegate(...args);
      }
    }
  }

  private handleRemoteUpdate: ServerEvents['remote:update'] = (ns, id, prop, oldValue, newValue) => {
    const store = this.observingStores.get(`${ns}:${id}`);
    if (store) {
      store.observed[prop] = newValue;

      for (const handler of store.handlers.values()) {
        handler(ns, id, prop, oldValue, newValue);
      }
    }
  }

  private handleSocketReconnect = (attempt: number) => {
    for (const [key, events] of this.delegates) {
      const [ns, id] = this.extractId(key);

      for (const event of Object.keys(events)) {
        this.socket.emit('remote:subscribe', ns, id, event, async (response) => {
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
      const [ns, id] = this.extractId(key);

      for (const handler of store.handlers) {
        this.socket.emit('remote:observe', ns, id, async (response) => {
          if (response.status !== undefined) {
            // Error reobserving
            store.remove(handler);

            if (store.count <= 0) {
              this.observingStores.delete(key);
            }
          }
        });
      }
    }
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

    for (const dispose of this.surrogateInfo.disposers) {
      dispose();
    }

    this.surrogateInfo.disposers.clear();

    this.socket.close();
  }

  private getDelegateEvents(ns: string, id: string) {
    const key = `${ns}:${id}` as const;

    if (!this.delegates.has(key)) {
      this.delegates.set(key, {});
    }

    return this.delegates.get(key)!;
  }

  private getDelegateFor(ns: string, id: string, event: string) {
    const events = this.getDelegateEvents(ns, id);
    const hasSet = !!events[event];
    return hasSet ? events[event]! : (() => events[event] = new Set<Callable>())();
  }

  private remoteGet(ns: string, id: string, prop: string) {
    return new Promise<any>((resolve, reject) => {
      this.socket.emit('remote:get', ns, id, prop, async (response: RemoteResponse<any>) => {
        if (response.status === undefined) {
          resolve(response.result);
          return;
        }

        reject(new RemotePropertyError(response.status, ns, id, prop, 'get'));
      });
    });
  }

  private remoteSet(ns: string, id: string, prop: string, value: any) {
    return new Promise<any>((resolve, reject) => {
      this.socket.emit('remote:set', ns, id, prop, value, async (response: RemoteResponse<any>) => {
        if (response.status === undefined) {
          resolve(response.result);
          return;
        }

        reject(new RemotePropertyError(response.status, ns, id, prop, 'set'));
      })
    });
  }

  private remoteInvoke(ns: string, id: string, method: string, ...args: any[]) {
    return new Promise<any>((resolve, reject) => {
      this.socket.emit('remote:invoke', ns, id, method, args, async (response: RemoteResponse<any>) => {
        if (response.status === undefined) {
          resolve(response.result);
          return;
        }

        reject(new RemoteInvocationError(response.status, ns, id, method));
      })
    })
  }

  private remoteSubscribe(ns: string, id: string, event: string, delegate: Callable) {
    return new Promise<void>((resolve, reject) => {
      const deletgates = this.getDelegateFor(ns, id, event);

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
      this.socket.emit('remote:subscribe', ns, id, event, async (response: RemoteResponse<void>) => {
        if (response.status !== undefined) {
          reject(new RemoteSubscriptionError(response.status, ns, id, event));
          return;
        }

        deletgates.add(delegate);
        resolve(response.result);
      });
    });
  }

  private remoteUnsubscribe(ns: string, id: string, event: string, delegate: Callable) {
    return new Promise<void>((resolve, reject) => {
      const events = this.getDelegateEvents(ns, id);
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
        this.delegates.delete(`${ns}:${id}`);
      }

      this.socket.emit('remote:unsubscribe', ns, id, event, async (response: RemoteResponse<void>) => {
        if (response.status !== undefined) {
          reject(new RemoteSubscriptionError(response.status, ns, id, event));
          return;
        }

        resolve();
      })
    });
  }

  private remoteObserve<NS extends Extract<keyof Types, string>>(ns: NS, id: string, handler: ObserverHandler<NS>) {
    return new Promise<Types[NS]>((resolve, reject) => {
      const key = `${ns}:${id}` as const;

      if (this.observingStores.has(key)) {
        const store = this.observingStores.get(key)!;

        store.add(handler);
        resolve(store.observed);
        return;
      }

      const store = new ObservingStore<Types[NS]>();
      this.observingStores.set(key, store);

      this.socket.emit('remote:observe', ns, id, async (response: RemoteResponse<any>) => {
        if (response.status !== undefined) {
          reject(new RemoteObservationError(response.status, ns, id));
          return;
        }

        store.observed = response.result;

        store.add(handler);
        resolve(store.observed);
      });
    });
  }

  private remoteUnobserve<NS extends Extract<keyof Types, string>>(ns: NS, id: string, handler: ObserverHandler<NS>) {
    return new Promise<void>((resolve, reject) => {
      const key = `${ns}:${id}` as const;

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

      this.socket.emit('remote:unobserve', ns, id, async (response) => {
        if (response.status === undefined) {
          resolve();
          return;
        }

        reject(new RemoteObservationError(response.status, ns, id));
      });
    });
  }

  async surrogateOf<NS extends Extract<keyof Types, string>>(StubClass: Stub<Types[NS]>, ns: NS, id: string) {
    const uuid = uniqueId('surrogate');

    const { descriptors } = StubClass;
    const mergedDescs = { ...descriptors.own, ...descriptors.proto };

    const propertyDescs = pickBy(mergedDescs, isProperty);
    const methodDescs = pickBy(mergedDescs, desc => isFunction(desc.value));

    const propertyChangeHandlers = new Map<string | AnyProp, Set<(newValue: any, oldValue: any) => Promise<any>>>();

    const propertyObserver: ObserverHandler<NS> = async (ns, id, prop, oldValue, newValue) => {
      const anyHandlers = propertyChangeHandlers.get($AnyProp);
      const propHandlers = propertyChangeHandlers.get(prop);

      const allHandlers: ((newValue: any, oldValue: any) => Promise<any>)[] = [];

      if (anyHandlers) {
        allHandlers.push(...anyHandlers)
      }

      if (propHandlers) {
        allHandlers.push(...propHandlers);
      }

      for (const handler of allHandlers) {
        handler(newValue, oldValue);
      }
    }

    const addPropertyChangeHandler = (name: string | undefined, handler: (oldValue: any, newValue: any) => any) => {
      const propKey = name ?? $AnyProp;

      if (!propertyChangeHandlers.has(propKey)) {
        propertyChangeHandlers.set(propKey, new Set());
      }

      const handlers = propertyChangeHandlers.get(propKey)!;
      handlers.add(handler);
    }

    const onDisposeHandlers = new Set<() => Promise<any>>();

    const addDisposeHandler = (handler: () => Promise<any>) => {
      onDisposeHandlers.add(handler);
    }

    const observe = async () => {
      return this.remoteObserve(ns, id, propertyObserver);
    }

    const observed = await observe();

    const subscriptionHandlers = new Map<string, Set<Callable>>;

    const on = (event: string, handler: Callable) => {
      this.remoteSubscribe(ns, id, event, handler);

      if (!subscriptionHandlers.has(event)) {
        subscriptionHandlers.set(event, new Set());
      }

      subscriptionHandlers.get(event)!.add(handler);
    }

    const off = (event: string, handler: Callable) => {
      this.remoteUnsubscribe(ns, id, event, handler);

      if (subscriptionHandlers.has(event)) {
        const handlers = subscriptionHandlers.get(event)!;

        handlers.delete(handler);

        if (handlers.size <= 0) {
          subscriptionHandlers.delete(event);
        }
      }
    }

    const emitterMethods = { on, off };

    const propertyGetters = mapValues(propertyDescs, (desc, name) => (...args: any[]) => new Promise(async (resolve, reject) => {
      if (args.length === 0) {
        resolve((observed as any)[name]);
        return;
      }

      if (args.length >= 1) {
        return await this.remoteSet(ns, id, name, args[0]);
      }
    }));

    const methods = mapValues(methodDescs, (desc, name) => (...args: any[]) => this.remoteInvoke(ns, id, name, ...args));

    const dispose = async () => {
      this.remoteUnobserve(ns, id, propertyObserver);

      for (const [event, handlers] of [...subscriptionHandlers]) {
        for (const handler of handlers) {
          this.remoteUnsubscribe(ns, id, event, handler);
        }
      }

      subscriptionHandlers.clear();

      for (const handler of onDisposeHandlers.values()) {
        handler();
      }

      onDisposeHandlers.clear();

      this.surrogateInfo.disposers.delete(dispose);
    }

    this.surrogateInfo.disposers.add(dispose);

    return new Proxy({ uuid } as {}, {
      get(target, prop) {
        if (prop === 'onPropertyChange') {
          return addPropertyChangeHandler;
        }

        if (prop === 'onDispose') {
          return addDisposeHandler;
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
    }) as Remotable<Types[NS]>;;
  }
}

abstract class RemoteError<NS> {
  constructor(readonly kind: RemoteErrorStatus, readonly ns: NS, readonly id: string) {

  }
}

class RemotePropertyError<NS> extends RemoteError<NS> {
  constructor(kind: RemoteErrorStatus, ns: NS, id: string, readonly prop: string, readonly direction: 'get' | 'set') {
    super(kind, ns, id);
  }
}

class RemoteInvocationError<NS> extends RemoteError<NS> {
  constructor(kind: RemoteErrorStatus, ns: NS, id: string, readonly method: string) {
    super(kind, ns, id);
  }
}

class RemoteSubscriptionError<NS> extends RemoteError<NS> {
  constructor(kind: RemoteErrorStatus, ns: NS, id: string, readonly event: string) {
    super(kind, ns, id);
  }
}

class RemoteObservationError<NS> extends RemoteError<NS> {

}
