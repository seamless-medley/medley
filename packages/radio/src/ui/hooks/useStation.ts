import { StubStation } from "../stubs/core/station";
import { useSurrogate } from "./surrogate";

export function useStation(id: string) {
  const { surrogate: station, error } = useSurrogate(StubStation, 'station', id);

  return {
    station,
    error
  }
}
