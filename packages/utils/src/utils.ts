export const randomNBit = (numberOfBits: number) => Math.floor(Math.random() * 2 ** numberOfBits);

export function createNamedFunc<F extends (...args: any) => any>(name: string, fn: F): F {
  const f = ({ [name]: function() { return fn.apply(this, arguments as any) } })[name] as F;
  return f;
}

export function numbersToRanges(...numbers: number[]): [start: number, end: number][] {
  const result: [start: number, end: number][] = [];

  numbers = numbers.sort((a, b) => a - b);

  let prev = undefined;
  let pair: [start: number, end: number] | undefined = undefined;

  for (const n of numbers) {
    if (prev && (n - prev > 1)) {
      pair = undefined;
    }

    if (pair === undefined) {
      pair = [n, 0];
      result.push(pair);
    }

    pair[1] = n + 1;

    prev = n;
  }

  return result;
}

export function concatUint8Array(...items: Uint8Array[]): Uint8Array {
  const size = items.reduce((size, a) => size + a.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const item of items) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}

export function hashString(s: string) {
  let hash = 0;

  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }

  return hash;
}
