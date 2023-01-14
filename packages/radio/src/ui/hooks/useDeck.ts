import { DeckIndex } from "@seamless-medley/core";
import { useEffect, useState } from "react";
import { DeckInfoWithPositions } from "../../socket/po/deck";
import { Station } from "../../socket/remote";
import { Remotable } from "../../socket/types";
import { useClient } from "../hooks/useClient";

type DeckCache = Partial<Record<DeckIndex, Promise<DeckInfoWithPositions | undefined>>>;

const cache = new WeakMap<Remotable<Station>, DeckCache>();

const ensureCache = (station: Remotable<Station>) => {
  if (!cache.has(station)) {
    cache.set(station, {});
  }
}

const storeCache = (station: Remotable<Station>, index: DeckIndex, info?: Promise<DeckInfoWithPositions | undefined>) => {
  ensureCache(station);
  cache.get(station)![index] = info;
}

const clearCache = (station: Remotable<Station>, index: DeckIndex) => {
  if (cache.has(station)) {
    cache.get(station)![index] = undefined;
  }
}

const getCache = (station: Remotable<Station>, index: DeckIndex) => {
  return cache.get(station)?.[index];
}

export function useDeck(station: Remotable<Station> | undefined, index: DeckIndex) {
  const client = useClient();

  const [info, setInfo] = useState<DeckInfoWithPositions | undefined>();
  const [cover, setCover] = useState<string | undefined>();

  const update = (deckIndex: number, newInfo: DeckInfoWithPositions) => {
    if (deckIndex !== index) {
      return;
    }

    setInfo(newInfo);

    const {
      cover,
      coverMimeType
    } = newInfo?.trackPlay?.track?.extra?.coverAndLyrics ?? {};

    setCover(cover && coverMimeType ? URL.createObjectURL(new Blob([cover])) : undefined);

    return newInfo;
  }

  const refreshDeckInfo = () => {
    if (!station) {
      console.log('Cannot refresh deck info', index);
      return Promise.resolve(undefined);
    }

    const promise = station.getDeckInfo(index).then(newInfo => update(index, newInfo));
    storeCache(station, index, promise);
    return promise;
  }

  const invalidateDeckInfo = () => {
    if (station) {
      clearCache(station, index);
    }
  }

  const onLoaded: Station['ϟdeckLoaded'] = async (deckIndex, newInfo) => {
    if (!station) {
      return;
    }

    if (deckIndex !== index) {
      return;
    }

    storeCache(station, deckIndex, Promise.resolve(update(deckIndex, newInfo)));
  }

  const onStarted: Station['ϟdeckStarted'] = async (deckIndex, positions) => {
    if (!station) {
      return;
    }

    if (deckIndex !== index) {
      return;
    }

    const cached = await getCache(station, deckIndex);

    if (!cached) {
      return;
    }

    const newInfo = {
      ...cached,
      playing: true,
      positions
    }

    setInfo(newInfo);
    storeCache(station, index, Promise.resolve(newInfo));
  }

  const onActive: Station['ϟdeckActive'] = async (deckIndex, positions) => {
    if (!station) {
      return;
    }

    if (deckIndex !== index) {
      return;
    }

    const cached = await getCache(station, deckIndex);

    if (!cached) {
      return;
    }

    const newInfo = {
      ...cached,
      playing: true,
      active: true,
      positions
    }

    setInfo(newInfo);
    storeCache(station, deckIndex, Promise.resolve(newInfo));
  }

  const onUnloaded: Station['ϟdeckUnloaded'] = async (deckIndex) => {
    if (deckIndex !== index) {
      return;
    }

    setInfo(undefined);
    setCover(undefined);

    if (!station) {
      return;
    }

    const cached = await getCache(station, deckIndex);

    if (!cached) {
      return;
    }

    clearCache(station, deckIndex);
  }

  useEffect(() => {
    // TODO: This won't work since the event was fired before receiving the station
    client.on('connect', refreshDeckInfo);
    client.on('disconnect', invalidateDeckInfo)

    return () => {
      client.off('connect', refreshDeckInfo);
      client.off('disconnect', invalidateDeckInfo);
    }
  }, [])

  useEffect(() => {
    if (!station) {
      return;
    }

    (getCache(station, index) ?? refreshDeckInfo()).then(info => {
      if (info) {
        update(index, info);
      }
    });

    station.on('deckLoaded', onLoaded);
    station.on('deckUnloaded', onUnloaded);
    station.on('deckStarted', onStarted);
    station.on('deckActive', onActive);

    return () => {
      station.off('deckLoaded', onLoaded);
      station.off('deckUnloaded', onUnloaded);
      station.off('deckStarted', onStarted);
      station.off('deckActive', onActive);
    }

  }, [station, index]);

  return {
    info,
    cover
  }
}
