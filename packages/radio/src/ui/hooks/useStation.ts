import { StubStation } from "../stubs/station";
import { useSurrogate } from "./surrogate";

export function useStation(id: string) {
  return useSurrogate(StubStation, 'station', id);
}
