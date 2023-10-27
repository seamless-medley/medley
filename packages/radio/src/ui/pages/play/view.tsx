import { useEffect, useState } from "react";
import { useParams } from "@tanstack/router";
import { prominent } from 'color.js'
import { Cover, CoverProps } from "../../components/play/cover/Cover";
import { route } from "./route";
import { useDeck, useDeckInfo } from "../../hooks/useDeck";
import { useStation } from "../../hooks/useStation";
import { Title } from "../../components/play/title/Title";

import { getLuminance,
  darken,
  lighten,
  shade,
  tint,
  adjustHue,
  setLightness,
  linearGradient,
  rgb,
  parseToHsl,
  setSaturation,
  hsl,
  radialGradient
} from 'polished';
import { Lyrics, defaultColors as defaultLyricsColors } from "../../components/play/lyrics/Lyrics";
import { PlayHead } from "../../components/play/playhead/PlayHead";
import { castArray, chain, random, sortBy, trim, uniq } from "lodash";
import { useRemotableProp } from "../../hooks/remotable";
import { useSetState } from "@mantine/hooks";
import type { DeckIndex, Metadata } from "@seamless-medley/core";
import { useClient } from "../../hooks/useClient";
import styled from "@emotion/styled";

const defaultCoverColors = [rgb(182, 244, 146), rgb(51, 139, 147)];

function findColor(base: string, predicate: (c: number) => boolean, fn: (deg: number, base: string) => string) {
  let deg = 0.1;
  let c = base;
  while (predicate(getLuminance(c))) {
    c = fn(deg, base);
    deg += 0.01;
  }

  return c;
}

export function formatSongBanner(tags?: Metadata): string | undefined {
  const artists = tags?.artist ? extractArtists(tags.artist) : undefined;

  const info: string[] = [];

  if (artists) {
    info.push(castArray(artists).join(','));
  }

  if (tags?.title) {
    info.push(tags?.title);
  }

  return info.length ? info.join(' - ') : undefined;
}

export const extractArtists = (artists: string) => uniq(artists.split(/[/;,]/)).map(trim);

export const getNextDeck = (index: DeckIndex): DeckIndex => [1, 2, 0][index];

const ListenButton = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  z-index: 90000;
  cursor: pointer;
  opacity: 0;
  border-radius: 0 0 0 0.5em;
  transition: all 0.7s ease;
  background-color: aqua;
  padding: 0 4px;

  :hover {
    opacity: 1;
  }
`;

export const Play: React.FC = () => {
  const client = useClient();
  const { station: stationId } = useParams({ from: route.id });

  const [station] = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  const { info, cover } = useDeckInfo(stationId, activeDeck);

  const [nextDeck] = useDeck(stationId, getNextDeck(activeDeck));
  const nextTrackPlay = useRemotableProp(nextDeck, 'trackPlay');

  const [coverProps, setCoverProps] = useSetState<CoverProps>({
    colors: [],
    url: cover,
    center: false,
    uuid: ''
  });

  const [titleText, setTitleText] = useState('');
  const [titleBg, setTitleBg] = useState('');

  const sortColors = (colors: string[]) => sortBy(colors, getLuminance);

  useEffect(() => {
    if (!cover) {
      const main = hsl(random(360), random(0.5, 0.9, true), random(0.6, 0.8, true));
      const deg = random(15, 20);

      setCoverProps({
        colors: sortColors(chain(6).times().map(i => adjustHue((i - 3) * deg, main)).value()),
        url: cover,
        center: (lyrics ? lyrics.timeline.length : 2) < 2,
        uuid: info.trackPlay?.uuid ?? ''
      });

      return;
    }

    prominent(cover, { format: 'hex', amount: 6 }).then(out => {
      setCoverProps({
        colors: sortColors(out as string[]),
        url: cover,
        center: (lyrics?.timeline?.length ?? 0) < 2,
        uuid: info.trackPlay?.uuid ?? ''
      });
    });
  }, [cover]);

  useEffect(() => {
    let gradient;

    if (coverProps.colors.length) {
      const titleColor = chain(coverProps.colors)
        .map(c => {
          const hsl = parseToHsl(c);

          if (hsl.saturation < 0.5) {
            c = setSaturation(0.5, c);
          }

          if (hsl.lightness < 0.5) {
            c = setLightness(0.5, c);
          }

          return findColor(adjustHue(-20, c), v => v < 0.3, lighten);
        })
        .shuffle()
        .flatMap(c => [c, adjustHue(random(15, 90), c)])
        .value();

      gradient = radialGradient({
        colorStops: titleColor,
        position: 'circle'
      }).backgroundImage;
    } else {
      gradient = linearGradient({
        colorStops: defaultCoverColors,
        toDirection: 'to right',
      }).backgroundImage;
    }

    setTitleBg(gradient.toString() ?? '');
  }, [cover]);

  useEffect(() => {
    const tags = info.trackPlay?.track?.extra?.tags;

    setTitleText(formatSongBanner(tags) || '');
  }, [info.trackPlay?.track?.extra?.tags]);

  useEffect(() => {
    const overrides = {
      overflow: 'hidden',
      'font-family': "'IBM Plex Sans Thai', Arial",
      'font-size': 'calc(100vh / 30)'
    }

    const saved: Record<string, string> = {};

    for (const [prop, value] of Object.entries(overrides)) {
      saved[prop] = document.body.style[prop as any];
      document.body.style[prop as any] = value;
    }

    return () => {
      for (const prop of Object.keys(overrides)) {
        document.body.style[prop as any] = saved[prop];
      }
    }
  }, []);

  const colors = (coverProps.colors.length >= 6) ? (() => {
    const [background, dim, text, shadow, active, glow] = coverProps.colors;

    return {
      background: findColor(background, v => v >= 0.01, darken),
      line: {
        text: findColor(text, v => v >= 0.045, darken),
        active: findColor(active, v => v < 0.9, tint),
        dim: findColor(dim, v => v >= 0.03, shade),
        shadow: findColor(shadow, v => v >= 0.11, shade),
        glow: findColor(glow, v => v < 0.97, lighten)
      }
    }
  })() : undefined;

  const lyrics = info?.trackPlay?.track?.extra?.coverAndLyrics?.lyrics;

  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      <ListenButton onClick={() => {
        client.playAudio(stationId);
      }}>
        Listen
      </ListenButton>
      <Cover { ...coverProps } />

      <Lyrics
        position={info.cp * 1000}
        {...{
          lineHeight: 1.8,
          lines: 8,
          lyrics,
          colors
        }}
      />
      <Title text={titleText} bg={titleBg} />
      <PlayHead
        backgroundColor={colors?.background ?? defaultLyricsColors.background}
        textColor={colors?.line?.text ?? defaultLyricsColors.line.text}
        activeColor={colors?.line?.active ?? defaultLyricsColors.line.active}

        next={formatSongBanner(nextTrackPlay?.track?.extra?.tags)}

        position={info.cp * 1000}
        duration={(info.duration ?? 0) * 1000}
      />

      <audio id="rtc_audio" />
    </div>
  )
}

export default Play;
