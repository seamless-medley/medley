import { computeCRC32, makeCRC32Table } from "@seamless-medley/utils";

export const polynomial = 0x04C11DB7;
export const mask = 0x80000000;
export const crcTable = makeCRC32Table(polynomial, mask);
export const compute = (data: Uint8Array) => computeCRC32(data, crcTable);
