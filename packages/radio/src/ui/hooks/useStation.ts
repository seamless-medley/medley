import { useSurrogate } from "./surrogate";

export function useStation(id: string) {
  const { surrogate: station, error } = useSurrogate('station', id);

  return {
    station,
    error
  }
}
