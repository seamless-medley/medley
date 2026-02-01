import type { DeckIndex } from "@seamless-medley/medley";
import { useCallback, useEffect, useState } from "react";
import { useSetState } from "@mantine/hooks";
import type { Deck, TrackPlay } from "@seamless-medley/remote";
import { useSurrogate } from "./surrogate";
import { client } from "@ui/init";
import { prominent } from "color.js";

export function useDeck(stationId: string | undefined, index: DeckIndex | undefined) {
  const { surrogate: deck, error } = useSurrogate('deck', stationId && index !== undefined ? `${stationId}/${index}` : undefined);
  return {
    deck,
    error
  }
}

export type UseDeckCoverColorOptions = {
  amount?: number;
  group?: number;
  sample?: number;
  getDefaultColors?: () => string[];
}

export type UseDeckCoverResult = {
  cover?: string;
  colors: string[]
}

export function useDeckCover(stationId: string | undefined, index: DeckIndex | undefined, colorOptions?: UseDeckCoverColorOptions): UseDeckCoverResult {
  const { deck } = useDeck(stationId, index);
  const [cover, setCover] = useState<string | undefined>();
  const [colors, setColors] = useState<string[] | undefined>();

  const updateCover = (newURL?: string) => setCover((oldCover) => {
    if (oldCover) {
      client.releaseURLForBuffer(oldCover);
    }

    return newURL;
  });

  const handleTrackPlay = useCallback(async (trackPlay?: TrackPlay) => {
    const {
      cover: newCover,
      coverMimeType
    } = trackPlay?.track?.extra?.coverAndLyrics ?? {};

    if (trackPlay && newCover && coverMimeType) {
      const coverUrl = client.getURLForBuffer(trackPlay?.uuid, { buffer: newCover, type: coverMimeType});
      updateCover(coverUrl);

      const coverColors = (colorOptions) ? await prominent(coverUrl, { ...colors, format: 'hex' }) as string[] : undefined;
      setColors(typeof coverColors === 'string' ? [coverColors as unknown as string] : coverColors);

    } else {
      updateCover(undefined);
      setColors(colorOptions?.getDefaultColors?.());
    }
  }, []);

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
        client.releaseURLForBuffer(cover);
      }
    }
  }, [stationId, index, cover]);

  return { cover, colors: colors ?? [] }
}

export type UseDeckInfoResult<K extends keyof Deck> = {
  [P in K]: Deck[P];
}

const $AnyProp: unique symbol = Symbol.for('$AnyProp');

export function useDeckInfo<Only extends keyof Deck = keyof Deck>(stationId: string | undefined, index: DeckIndex | undefined, ...onlyProps: Only[]): UseDeckInfoResult<Only> {
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

export function useDeckMetaData(stationId: string | undefined, index: DeckIndex)  {
  const { trackPlay } = useDeckInfo(stationId, index, 'trackPlay');
  return trackPlay?.track?.extra?.tags;
}
