import { isFunction, isString, pickBy } from "lodash";

export function isPublicPropertyName(name: any) {
  return isString(name) && !/^[_$ϟ]/.test(name) && !['constructor'].includes(name);
}

export function propertyDescriptorOf(o: any) {
  return pickBy(Object.getOwnPropertyDescriptors(o), (_, prop) => isPublicPropertyName(prop));
}

export function isProperty(desc: PropertyDescriptor): boolean {
  return (!!desc.get || !!desc.set) || !isFunction(desc.value);
}
