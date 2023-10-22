import { StubCollection } from "../stubs/core/collection";
import { useSurrogate } from "./surrogate";

export function useCollection(id?: string) {
  return useSurrogate(StubCollection, 'collection', id);
}
