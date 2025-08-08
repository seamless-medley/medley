import type { DeckIndex } from "@seamless-medley/medley";
import { useCallback, useEffect, useState } from "react";
import { useSetState } from "@mantine/hooks";
import type { Deck, TrackPlay } from "@seamless-medley/remote";
import { useSurrogate } from "./surrogate";

export function useDeck(stationId: string | undefined, index: DeckIndex | undefined) {
  const { surrogate: deck, error } = useSurrogate('deck', stationId ? `${stationId}/${index}` : undefined);
  return {
    deck,
    error
  }
}

export function useDeckCover(stationId: string | undefined, index: DeckIndex) {
  const { deck } = useDeck(stationId, index);
  const [cover, setCover] = useState<string | undefined>();

  const updateCover = (newURL?: string) => setCover((oldCover) => {
    if (oldCover) {
      URL.revokeObjectURL(oldCover);
    }

    return newURL;
  });

  const handleTrackPlay = (trackPlay?: TrackPlay) => {
    const {
      cover,
      coverMimeType
    } = trackPlay?.track?.extra?.coverAndLyrics ?? {};

    updateCover(
      cover && coverMimeType
        ? URL.createObjectURL(new Blob([cover], { type: coverMimeType }))
        : undefined
    );
  }

  useEffect(() => {
    if (!deck) {
      return;
    }

    deck.getProperty('trackPlay').then(handleTrackPlay);

    return deck.addPropertyChangeListener('trackPlay', handleTrackPlay);
  }, [deck]);

  useEffect(() => {
    return () => {

      if (cover) {
        URL.revokeObjectURL(cover);
      }
    }
  }, [stationId, index]);

  return cover;
}

export type UseDeckInfoResult<K extends keyof Deck> = {
  [P in K]: Deck[P];
}

const $AnyProp: unique symbol = Symbol.for('$AnyProp');

export function useDeckInfo<Only extends keyof Deck = keyof Deck>(stationId: string | undefined, index: DeckIndex, ...onlyProps: Only[]): UseDeckInfoResult<Only> {
  type PV = Deck[keyof Deck];

  const { deck } = useDeck(stationId, index);

  const [info, setInfo] = useSetState<Deck>({
    active: false,
    playing: false,
    cp: 0,
    duration: 0,
    first: 0,
    last: 0,
    cuePoint: 0,
    leading: 0,
    trailing: 0,
    transitionStart: 0,
    transitionEnd: 0,
    trackPlay: undefined
  });

  const handleChange = useCallback((newValue: PV, oldValue: PV, prop: keyof Deck) => {
    if (onlyProps.length && !onlyProps.includes(prop as any)) {
      return;
    }

    setInfo({
      [prop]: newValue
    });
  }, [deck]);

  useEffect(() => {
    if (!deck) {
      return;
    }

    const info = deck.getProperties();
    setInfo(info);

    return deck.addPropertyChangeListener($AnyProp, handleChange);
  }, [deck]);

  return info;
}
