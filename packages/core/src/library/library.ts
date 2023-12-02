import EventEmitter from "events";

type IDOf<T> = T extends { id: infer ID } ? ID : any;

export interface IReadonlyLibrary<T extends { id: ID }, ID = IDOf<T>> extends Iterable<T> {
  get size(): number;

  has(id: ID): boolean;

  get(id: ID): T | undefined;

  all(): T[];

  first(): T | undefined;
}

export class BaseLibrary<T extends { id: ID }, ID = IDOf<T>> extends EventEmitter implements Iterable<T> {
  protected elements = new Map<ID, T>();

  constructor(...elements: T[]) {
    super();
    this.add(...elements);
  }

  protected isType(o: T | ID): o is T {
    return !!(o as any).id;
  }

  protected has(id: ID): boolean {
    return this.elements.has(id);
  }

  protected add(...elements: T[]) {
    for (const e of elements) {
      this.elements.set(e.id, e);
    }
  }

  protected remove(...elements: (T | ID)[]) {
    for (const e of elements) {
      this.elements.delete(this.isType(e) ? e.id : e);
    }
  }

  protected get(id: ID): T | undefined {
    return this.elements.get(id);
  }

  [Symbol.iterator](): Iterator<T, any, undefined> {
    return this.elements.values();
  }

  protected get size() {
    return this.elements.size;
  }

  protected all(): T[] {
    return Array.from(this.elements.values());
  }

  protected first(): T | undefined {
    return this.elements.values().next().value as T | undefined;
  }

  protected last(): T | undefined {
    return this.all().pop();
  }

  keys() {
    return this.elements.keys();
  }
}

export class Library<T extends { id: ID }, ID = IDOf<T>> extends BaseLibrary<T, ID> implements IReadonlyLibrary<T, ID> {
  get size() {
    return super.size;
  }

  has(id: ID): boolean {
    return super.has(id);
  }

  get(id: ID): T | undefined {
    return super.get(id);
  }

  add(...elements: T[]) {
    super.add(...elements);
  }

  remove(...elements: (T | ID)[]) {
    super.remove(...elements);
  }

  contains(el: T) {
    return new Set(this.elements.values()).has(el);
  }

  all(): T[] {
    return super.all();
  }

  first(): T | undefined {
    return super.first();
  }

  last(): T | undefined {
    return super.last()
  }
}
