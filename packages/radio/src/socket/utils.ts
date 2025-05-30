import type { Readable, Stream, Writable } from "node:stream";

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
