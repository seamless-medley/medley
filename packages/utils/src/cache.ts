export function cachedWith<K, O extends WeakKey>(getter: (key: K) => Promise<O>) {
  const cache = new Map<K, WeakRef<O>>();

  const finalizationHandler = (key: K) => {
    if (!cache.get(key)?.deref()) {
      cache.delete(key)
    }
  }

  const registry = new FinalizationRegistry(finalizationHandler);

  return async (key: K) => {
    if (cache.has(key)) {
      return cache.get(key)!.deref()!;
    }

    const value = await getter(key);
    cache.set(key, new WeakRef(value));
    registry.register(value, key);

    return value;
  }
}
