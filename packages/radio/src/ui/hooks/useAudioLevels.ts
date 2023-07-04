import { StationAudioLevels } from "@seamless-medley/core";
import { gainToDecibels, interpolate } from "@seamless-medley/utils";
import { mapValues } from "lodash";
import { compose } from "lodash/fp";
import { useEffect } from "react";
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
  level: number;
  peak: number;
}

export type UseAudioLevelsData = {
  left: NormalizedAudioLevel;
  right: NormalizedAudioLevel;
  reduction: number;
}

export function useAudioLevels(callback: (data: UseAudioLevelsData) => any, options?: { max?: number }) {
  const max = options?.max ?? 0;
  const normalize = (v: number) => interpolate(Math.min(v, max), [-100, max], [0, 1]);
  const process = compose(normalize, gainToDecibels);

  const client = useClient();

  let raf = 0;

  const update = (levels: StationAudioLevels) => {
    const left = mapValues({ ...levels.left }, process);
    const right = mapValues({ ...levels.right }, process);
    const reduction = normalize(levels.reduction + max);

    raf = requestAnimationFrame(() => {
      callback({
        left: {
          level: left.magnitude,
          peak: left.peak
        },
        right: {
          level: right.magnitude,
          peak: right.peak
        },
        reduction
      });

      raf = 0;
    });
  }

  const handleAudioExtra = (extra: AudioTransportExtra) => {
    const [,, left, right, reduction] = extra;
    update({
      left: {
        magnitude: left[0],
        peak: left[1]
      },
      right: {
        magnitude: right[0],
        peak: right[1]
      },
      reduction
    })
  }

  const handleDisconnect = () => update(emptyLevel);

  useEffect(() => {
    client.on('audioExtra', handleAudioExtra);
    client.on('disconnect', handleDisconnect);

    return () => {
      cancelAnimationFrame(raf);
      client.off('audioExtra', handleAudioExtra);
      client.off('disconnect', handleDisconnect);
    }
  }, []);
}
