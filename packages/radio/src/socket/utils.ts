import { isFunction, isString, pickBy } from "lodash";
import type { Readable, Stream, Writable } from "stream";

export function isPublicPropertyName(name: any) {
  return isString(name) && !/^[_$ϟ]/.test(name) && !['constructor'].includes(name);
}

export function propertyDescriptorOf(o: any) {
  return pickBy(Object.getOwnPropertyDescriptors(o), (_, prop) => isPublicPropertyName(prop));
}

export function isProperty(desc: PropertyDescriptor) {
  return (desc.get || desc.set) || !isFunction(desc.value);
}

export function isStream(o: any): o is Stream  {
	return o !== null
		&& typeof o === 'object'
		&& typeof o.pipe === 'function';
}

export function isWritableStream(o: any): o is Writable {
	return isStream(o)
		&& (o as any).writable !== false
		&& typeof (o as any)._write === 'function'
		&& typeof (o as any)._writableState === 'object';
}

export function isReadableStream(o: any): o is Readable {
	return isStream(o)
		&& (o as any).readable !== false
		&& typeof (o as any)._read === 'function'
		&& typeof (o as any)._readableState === 'object';
}
