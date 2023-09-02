import { StationAudioLevels } from "@seamless-medley/core";
import { gainToDecibels, interpolate } from "@seamless-medley/utils";
import { mapValues } from "lodash";
import { compose } from "lodash/fp";
import { useCallback, useEffect, useRef } from "react";
import { AudioTransportExtra } from "../../audio/types";
import { useClient } from "./useClient";

const emptyLevel: StationAudioLevels = {
  left: {
    magnitude: 0,
    peak: 0
  },
  right: {
    magnitude: 0,
    peak: 0
  },
  reduction: 0
}

type NormalizedAudioLevel = {
  magnitude: number;
  peak: number;
}

export type UseAudioLevelsData = {
  left: NormalizedAudioLevel;
  right: NormalizedAudioLevel;
  reduction: number;
}

export function useAudioLevels(callback: (data: UseAudioLevelsData) => any, options?: { max?: number }) {
  console.log('useAudioLevels');

  const max = options?.max ?? 0;
  const normalize = (v: number) => interpolate(Math.min(v, max), [-100, max], [0, 1]);
  const process = compose(normalize, gainToDecibels);

  const client = useClient();
  const callbackRef = useRef<typeof callback>();
  const raf = useRef(0);

  const update = (levels: StationAudioLevels) => {
    const left = mapValues(levels.left, process);
    const right = mapValues(levels.right, process);
    const reduction = normalize(levels.reduction + max);

    raf.current = requestAnimationFrame(() => {
      callbackRef.current?.({
        left,
        right,
        reduction
      });

      raf.current = 0;
    });
  }

  const handleAudioExtra = useCallback((extra: AudioTransportExtra) => update(extra.audioLevels), []);
  const handleDisconnect = useCallback(() => update(emptyLevel), []);

  useEffect(() => {
    client.on('audioExtra', handleAudioExtra);
    client.on('disconnect', handleDisconnect);

    return () => {
      cancelAnimationFrame(raf.current);
      client.off('audioExtra', handleAudioExtra);
      client.off('disconnect', handleDisconnect);
    }
  }, []);
}
