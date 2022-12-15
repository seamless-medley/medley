import { isFunction, isString, pickBy } from "lodash";
import { StubOf } from "./stub";

export interface RemoteCounter {
  count: number;

  inc(amount: number | undefined): void;
  reset(to: number): number;

  ϟincreased(newValue: number): void;
}

export interface NS1 {
  ns1Prop: number;
  func2(someText: string): number;

  ϟtest(): void;
}

export interface RemoteTypes {
  root: RemoteCounter;
  ns1: NS1;
}

export const StubCounter = StubOf<RemoteCounter>(class {
  get count() {
    return 0;
  }

  inc(amount: number | undefined): void {

  }

  reset(to: number): number {
    return 0;
  }
});

export const StubNS1 = StubOf<NS1>(class {
  ns1Prop = 0;

  func2(someText: string): number {
    return 0;
  }
});

export function isPublicPropertyName(name: any) {
  return isString(name) && !name.startsWith('_') && !['constructor'].includes(name);
}

export function propertyDescriptorOf(o: any) {
  return pickBy(Object.getOwnPropertyDescriptors(o), (_, prop) => isPublicPropertyName(prop));
}

export function isProperty(desc: PropertyDescriptor) {
  return (desc.get || desc.set) || !isFunction(desc.value);
}


