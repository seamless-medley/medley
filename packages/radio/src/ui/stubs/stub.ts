import "reflect-metadata";
import { propertyDescriptorOf } from "@seamless-medley/utils";
import { WithoutEvents } from "../../remotes/types";

type StubCtor<T> = abstract new (...args: any) => WithoutEvents<T>;

export type Stub<T> = {
  readonly StubbedFrom: StubCtor<T>;
  readonly descriptors: Record<'own' | 'proto', ReturnType<typeof propertyDescriptorOf>>;
}

/**
 * A mixin for creating a class that conforms to a remote interface
 *
 * The wrapped class must implement type/interface `T`
 * the implementation could simply be anything as it won't actually be used
 *
 * The point for stubbing is to expose property descriptors at runtime as this wouldn't be possible by using typing alone
 */
export function StubOf<T>(wrapped: StubCtor<T>): Stub<T> {
  const AnyCtor = wrapped as (abstract new () => any);

  const Inst = class extends AnyCtor {

  }

  const name = `StubOf${wrapped.name}`;

  const Stubbed = ({
    [name]: class extends AnyCtor {
      static readonly StubbedFrom = wrapped;

      static get descriptors() {
        return {
          own: propertyDescriptorOf(new Inst),
          proto: propertyDescriptorOf(wrapped.prototype)
        }
      }
    }
  })[name];

  return Stubbed;
}

const $RemoteTimeout = Symbol.for("$RemoteTimeout");

export const RemoteTimeout = (n: number = 60_000) => (target: any, prop?: string) => {
  if (prop) {
    Reflect.defineMetadata($RemoteTimeout, n, target.constructor, prop);
  } else {
    Reflect.defineMetadata($RemoteTimeout, n, target);
  }
}

export function getRemoteTimeout(target: any, prop?: string) {
  const result = prop ? Reflect.getMetadata($RemoteTimeout, target, prop) : undefined;
  return result ?? Reflect.getMetadata($RemoteTimeout, target);
}

