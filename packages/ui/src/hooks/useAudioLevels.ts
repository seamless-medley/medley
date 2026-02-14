import { gainToDecibels, interpolate } from "@seamless-medley/utils";
import { mapValues } from "lodash";
import { type DependencyList, useCallback, useEffect } from "react";
import type { StationAudioLevels, AudioTransportExtra } from "@seamless-medley/remote";
import { client } from "@ui/init";

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

type AudioLevel = {
  magnitude: number;
  peak: number;
}

type ChannelAudioLevel = Record<'scaled' | 'db' | 'level', AudioLevel>

export type UseAudioLevelsData = {
  left: ChannelAudioLevel;
  right: ChannelAudioLevel;
  reduction: number;
}

export function useAudioLevels(callback: (data: UseAudioLevelsData) => any, deps: DependencyList, options?: { max?: number }) {
  const max = options?.max ?? 0;
  const normalize = (db: number) => interpolate(Math.min(db, max), [-100, max], [0, 1]);

  const levelToChannelLevel = (level: AudioLevel): ChannelAudioLevel => {
    const db = mapValues(level, gainToDecibels)
    return {
      scaled: mapValues(db, normalize),
      level,
      db
    }
  };

  const update = useCallback((levels: StationAudioLevels) => {
    const reduction = normalize(levels.reduction);

    callback({
      left: levelToChannelLevel(levels.left),
      right: levelToChannelLevel(levels.right),
      reduction
    });
  }, [callback]);

  const handleAudioExtra = useCallback((extra: AudioTransportExtra) => update(extra.audioLevels), [update]);
  const handleDisconnect = useCallback(() => update(emptyLevel), [update]);

  useEffect(() => {
    client.on('audioExtra', handleAudioExtra);
    client.on('disconnect', handleDisconnect);

    return () => {
      client.off('audioExtra', handleAudioExtra);
      client.off('disconnect', handleDisconnect);
    }
  }, deps);
}
