import { noop } from "lodash";
import { $console$inspect } from "./inspect";
import { createNamedFunc } from "./utils";

export type BitFieldResolvable<T extends BitField<any>> = T | number | bigint | number[] | bigint[];

export class BitField<T extends BitField<any>> {
  static Flags: Record<string, bigint> = {};

  static Defaults: bigint = 0n;

  #values: bigint;

  #class = (this.constructor as typeof BitField);

  constructor(value?: bigint) {
    this.#values = value ?? this.defaults;
  }

  get defaults() {
    return this.#class.Defaults;
  }

  valueOf() {
    return this.#values;
  }

  /**
   * Returns `true` if all bits of the specified `bit` are set
   */
  has(bit: BitFieldResolvable<T>): boolean {
    const b = this.resolve(bit);
    return (this.#values & b) === b;
  }

  /**
   * Returns `true` if any bit of the specified `bit` is set
   */
  any(bit: BitFieldResolvable<T>): boolean {
    const b = this.resolve(bit);
    return (this.#values & b) !== this.defaults;
  }

  equals(bit: BitFieldResolvable<T>): boolean {
    return this.#values === this.resolve(bit);
  }

  add(other: T): this;
  add(bits: bigint): this;
  add(bits: bigint[]): this;
  add(bits: T | bigint | bigint[]): this {
    if (bits instanceof BitField) {
      if (bits.#class === this.#class) {
        this.add([bits.#values])
      }

      return this;
    }

    if (typeof bits === 'bigint') {
      this.#values |= bits;
      return this;
    }

    this.#values |= bits.reduce((a, b) => a | b, this.defaults);
    return this;
  }

  remove(other: T): this;
  remove(bits: bigint): this;
  remove(bits: bigint[]): this;
  remove(bits: T | bigint | bigint[]): this {
    if (bits instanceof BitField) {
      if (bits.#class === this.#class) {
        this.remove([bits.#values])
      }

      return this;
    }

    if (typeof bits === 'bigint') {
      this.#values &= ~bits;
      return this;
    }

    this.#values &= ~bits.reduce((a, b) => a | b, this.defaults);
    return this;
  }

  invert(): T {
    const mask = Object.values(this.#class.Flags).reduce((a, b) => a | b, 0n);
    return new this.#class(mask ^ this.#values) as T;
  }

  *[Symbol.iterator]() {
    for (const [name, flag] of Object.entries(this.#class.Flags)) {
      if (this.has(flag)) yield name;
    }
  }

  resolve(bit: BitFieldResolvable<T>): bigint {
    if (bit instanceof BitField) {
      return bit.#values;
    }

    if (Array.isArray(bit)) {
      return bit.map(b => this.resolve(b)).reduce((a, b) => a | BigInt(b), 0n);
    }

    return BigInt(bit);
  }

  bitString(group?: boolean) {
    const s = this.#values.toString(2);
    const count = s.length;
    const numDigits = Math.ceil(count / 8) * 8;
    const padded = s.padStart(numDigits, '0');

    return group ? Array.from(padded.match(/\d{8}/g) ?? []).join(' ') : padded;
  }

  bits() {
    return Array.from(this.bitString()).map(c => Boolean(Number(c)));
  }

  inspect() {
    const digits = this.bitString(true);
    return `${this.#class.name} { ${digits} }`;
  }

  dump() {
    return ((r) => {
      r.value = this.#values
      r.bits = this.bitString(true);
      r.flags = Array.from(this);
      return r;
    })(new (createNamedFunc(this.#class.name, noop) as unknown as (new () => any))());
  }

  [$console$inspect]() {
    return this.inspect();
  }
}
