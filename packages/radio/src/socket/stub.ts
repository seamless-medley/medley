import { propertyDescriptorOf } from "./remote/utils";
import { WithoutEvents } from "./types";

type StubCtor<T> = abstract new () => WithoutEvents<T>;

export type Stub<T> = {
  readonly StubbedFrom: StubCtor<T>;
  readonly descriptors: Record<'own' | 'proto', ReturnType<typeof propertyDescriptorOf>>;
}

export interface StubbingMarker<T> {

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

  abstract class Stubbed extends AnyCtor implements StubbingMarker<T> {
    static readonly StubbedFrom = wrapped;

    static get descriptors() {
      return {
        own: propertyDescriptorOf(new Inst),
        proto: propertyDescriptorOf(wrapped.prototype)
      }
    }
  };

  return Stubbed;
}


