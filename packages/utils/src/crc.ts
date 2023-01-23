const makeGenerator = (polynomial: number, mask: number) => (index: number) => Array(8)
  .fill(0)
  .reduce(
    (r) => r & mask ? (polynomial ^ r << 1) : (r << 1),
    index << 24
  );

export function makeCRC32Table(polynomial: number, mask: number) {
  const generate = makeGenerator(polynomial, mask);
  return new Uint32Array(256).map((_, i) => generate(i));
}

export const computeCRC32 = (data: Uint8Array, table: Uint32Array) => data.reduce(
  (crc, byte) => crc << 8 >>> 0 ^ table[crc >>> 24 ^ byte],
  0
) >>> 0
