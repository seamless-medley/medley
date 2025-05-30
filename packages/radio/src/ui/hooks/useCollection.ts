import { useSurrogate } from "./surrogate";

export function useCollection(id?: string) {
  const { surrogate: collection, error } = useSurrogate('collection', id);
  return {
    collection,
    error
  }
}
