import { propertyDescriptorOf } from "./remote";
import { WithoutEvents } from "./types";

export function StubOf<T>(cls: abstract new () => WithoutEvents<T>) {
  const AnyCtor = cls as (abstract new () => any);

  const Inst = class extends AnyCtor {

  }

  abstract class Stubbed<From> extends AnyCtor {
    readonly StubbedFrom = cls as From;

    static get descriptors() {
      return {
        own: propertyDescriptorOf(new Inst),
        proto: propertyDescriptorOf(cls.prototype)
      }
    }
  };

  return Stubbed<T>;
}

export type Stub<T> = ReturnType<typeof StubOf<T>>;
