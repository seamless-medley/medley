import { StationAudioLevels } from "@seamless-medley/core";
import { gainToDecibels, interpolate } from "@seamless-medley/utils";
import { mapValues } from "lodash";
import { compose } from "lodash/fp";
import { useEffect } from "react";
import { Station } from "../../socket/remote";
import { useClient } from "./useClient";
import { useStation } from "./useStation";

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

function arrayBufferToAudioLevels(buffer?: ArrayBuffer): StationAudioLevels {
  if (!buffer || (buffer.byteLength < 8 * 5)) {
    return emptyLevel;
  }

  const view = new Float64Array(buffer);

  return {
    left: {
      magnitude: view[0],
      peak: view[1]
    },
    right: {
      magnitude: view[2],
      peak: view[3]
    },
    reduction: view[4]
  }
}


export function useAudioLevels(stationId: string, callback: (data: UseAudioLevelsData) => any, options?: { max?: number }) {
  const max = options?.max ?? 0;
  const normalize = (v: number) => interpolate(Math.min(v, max), [-100, max], [0, 1]);
  const process = compose(normalize, gainToDecibels);

  const client = useClient();
  const station = useStation(stationId);

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

  const handleAudioLevels: Station['ϟaudioLevels'] = (buffer) => update(arrayBufferToAudioLevels(buffer));
  const handleDisconnect = () => update({
    left: { magnitude: 0, peak: 0 },
    right: { magnitude: 0, peak: 0 },
    reduction: 0
  });

  useEffect(() => {
    if (!station) {
      return;
    }

    client.on('disconnect', handleDisconnect)
    station.on('audioLevels', handleAudioLevels);

    return () => {
      cancelAnimationFrame(raf);
      station.off('audioLevels', handleAudioLevels);
      client.off('disconnect', handleDisconnect);
    }
  }, [station]);
}
