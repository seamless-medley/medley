import { Primitive } from "type-fest";

export type TypeOrArray<T> = T | T[];

export type PrimitiveOrArray = TypeOrArray<Primitive>;

export type PrimitiveKeyValue = PrimitiveOrArray | { [key: string]: PrimitiveKeyValue };

export type Callable = (...args: any[]) => any;

export type ParametersOf<T> = T extends (...args: infer A) => any ? A : never;

export type ReturnTypeOf<T> = T extends (...args: any) => infer R ? R : never;

export type AsyncFunctionOf<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
