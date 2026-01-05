export function cachedWith<K, O extends WeakKey>(getter: (key: K) => Promise<O>) {
  const cache = new Map<K, WeakRef<O>>();

  const finalizationHandler = (key: K) => {
    const ref = cache.get(key);

    if (!ref) {
      return;
    }

    if (ref.deref()) {
      cache.delete(key);
    }
  }

  const registry = new FinalizationRegistry(finalizationHandler);

  return async (key: K) => {
    if (cache.has(key)) {
      const cached = cache.get(key)!.deref();

      if (cached !== undefined) {
        return cached;
      }
    }

    const value = await getter(key);
    cache.set(key, new WeakRef(value));
    registry.register(value, key);

    return value;
  }
}
