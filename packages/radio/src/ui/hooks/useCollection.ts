import { StubCollection } from "../stubs/core/collection";
import { useSurrogate } from "./surrogate";

export function useCollection(id?: string) {
  const { surrogate: collection, error } = useSurrogate(StubCollection, 'collection', id);
  return {
    collection,
    error
  }
}
