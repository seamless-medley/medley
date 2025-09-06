import { useSurrogate } from "./surrogate";

export function useCollection(station: string | undefined, id: string | undefined) {
  if (!station || !id) {
    return {
      collection: undefined,
      error: undefined
    };
  }

  const { surrogate: collection, error } = useSurrogate('collection', `${station}/${id}`);

  return {
    collection,
    error
  }
}
