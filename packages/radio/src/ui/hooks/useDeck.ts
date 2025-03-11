import type { DeckIndex } from "@seamless-medley/core";
import { useCallback, useEffect, useState } from "react";
import { type Deck } from "../../remotes/core/deck";
import { type TrackPlay } from "../../remotes/core/po/track";
import { StubDeck } from "../stubs/core/deck";
import { $AnyProp } from "../../socket";
import { useSurrogate } from "./surrogate";
import { useSetState } from "@mantine/hooks";

export function useDeck(stationId: string | undefined, index: DeckIndex | undefined) {
  const { surrogate: deck, error } = useSurrogate(StubDeck, 'deck', stationId ? `${stationId}/${index}` : undefined);
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
