import { ListenerSignature, TypedEmitter } from "tiny-typed-emitter";

type IDOf<T> = T extends { id: infer ID } ? ID : never;

type LibraryEvents<E extends ListenerSignature<any>, T> = E & {
  changed: () => void;
  add: (element: T) => void;
  remove: (element: T) => void;
}

export interface IReadonlyLibrary<T extends { id: ID }, Events extends ListenerSignature<Events> = {}, ID = IDOf<T>> extends Iterable<T> {
  get size(): number;

  has(id: ID): boolean;

  get(id: ID): T | undefined;

  all(): T[];

  first(): T | undefined;

  on<U extends keyof LibraryEvents<Events, T>>(event: U, listener: LibraryEvents<Events, T>[U]): this;

  off<U extends keyof LibraryEvents<Events, T>>(event: U, listener: LibraryEvents<Events, T>[U]): this;
}

export class BaseLibrary<T extends { id: ID }, Events extends ListenerSignature<Events> = {}, ID = IDOf<T>> extends TypedEmitter<LibraryEvents<Events, T>> implements Iterable<T> {
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
    let changed = false;

    for (const e of elements) {
      if (!this.elements.has(e.id)) {
        (this.emit as any)('add', e);
        changed = true;
      }
      else if (this.elements.get(e.id) !== e) {
        changed = true;
      }

      this.elements.set(e.id, e);
    }

    if (changed) {
      (this.emit as any)('changed');
    }
  }

  protected remove(...elements: Array<T | ID>) {
    let changed = false;

    for (const e of elements) {
      const key = this.isType(e) ? e.id : e;
      const item = this.elements.get(key);

      if (this.elements.delete(key)) {
        (this.emit as any)('remove', item);
        changed = true;
      }
    }

    if (changed) {
      (this.emit as any)('changed');
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

export class Library<T extends { id: ID }, Events extends ListenerSignature<Events>, ID = IDOf<T>> extends BaseLibrary<T, Events, ID> implements IReadonlyLibrary<T, Events, ID> {
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
    return super.last();
  }
}
