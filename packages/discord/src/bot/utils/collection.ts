type IDOf<T> = T extends { id: infer ID } ? ID : any;

export interface IReadonlyCollection<T extends { id: ID }, ID = IDOf<T>> extends Iterable<T> {
  get size(): number;

  has(id: ID): boolean;

  get(id: ID): T | undefined;

  all(): T[];

  first(): T | undefined;
}

export class BaseCollection<T extends { id: ID }, ID = IDOf<T>> implements Iterable<T> {
  protected elements = new Map<ID, T>();

  constructor(...elements: T[]) {
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

  protected all() {
    return Array.from(this.elements.values());
  }

  protected first() {
    return this.elements.values().next().value as T | undefined;
  }

  keys() {
    return this.elements.keys();
  }
}

export class Collection<T extends { id: ID }, ID = IDOf<T>> extends BaseCollection<T, ID> implements IReadonlyCollection<T, ID> {
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

  all(): T[] {
    return super.all();
  }

  first(): T | undefined {
    return super.first();
  }
}