import { useSurrogate } from './surrogate';
import { StubRadioInfo } from '../stubs/core/info'

export function useRadioInfo() {
  const { surrogate: radioInfo, error } = useSurrogate(StubRadioInfo, 'radioInfo', "0");
  return {
    radioInfo,
    error,
  };
}
