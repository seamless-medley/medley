import { useEffect, useMemo, useState } from "react";

import { styled } from "@linaria/react";
import { Button } from "@mantine/core";
import { useSetState } from "@mantine/hooks";

import { formatTags } from "@seamless-medley/utils";

import { prominent } from 'color.js'

import { chain, random, sample, sortBy } from "lodash";

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
  hsl
} from 'polished';

import { useDeckCover, useDeckInfo } from "@ui/hooks/useDeck";
import { useStation } from "@ui/hooks/useStation";
import { useRemotableProp } from "@ui/hooks/remotable";

import { client } from "@ui/init";

import { Cover, CoverProps } from "./components/Cover";
import { Title } from "./components/Title";
import { Lyrics, defaultColors as defaultLyricsColors } from "./components/Lyrics";
import { PlayHead } from "./components/PlayHead";

import { Route } from "./route";

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

const Control = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  padding: 0;
  z-index: 90000;
  cursor: pointer;
  opacity: 0;
  border-radius: 0 0 0 0.5em;
  transition: all 0.7s ease;

  user-select: none;

  &:hover {
    opacity: 1;
  }
`;

export const Play: React.FC = () => {
  const { station: stationId } = Route.useParams();

  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  const cover = useDeckCover(stationId, activeDeck);
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const [coverProps, setCoverProps] = useSetState<CoverProps>({
    colors: [],
    url: cover,
    center: false,
    uuid: ''
  });

  const [titleText, setTitleText] = useState('');
  const [titleBg, setTitleBg] = useState('');

  const sortColors = (colors: string[]) => sortBy(colors, c => parseToHsl(c).hue);

  useEffect(() => {
    if (!cover) {
      console.log('No cover');

      const main = hsl(random(360), random(0.5, 0.9, true), random(0.6, 0.8, true));
      const deg = random(15, 20);

      setCoverProps({
        colors: sortColors(chain(6).times().map(i => adjustHue((i - 3) * deg, main)).value()),
        url: cover,
        center: (lyrics ? lyrics.timeline.length : 2) < 2,
        uuid: trackPlay?.uuid ?? ''
      });

      return;
    }

    console.log('Prominent colors');

    prominent(cover, { format: 'hex', amount: 6 }).then(out => {
      setCoverProps({
        colors: sortColors(out as string[]),
        url: cover,
        center: (lyrics?.timeline?.length ?? 0) < 2,
        uuid: trackPlay?.uuid ?? ''
      });
    });
  }, [cover]);

  useEffect(() => {
    let gradient;

    console.log('Colors', coverProps.colors);

    const extent = ['farthest-side at', sample(['left', 'right']), sample(['top', 'bottom'])].join(' ');

    if (coverProps.colors.length) {
      const titleColor = chain(coverProps.colors)
        .map(c => {
          const hsl = parseToHsl(c);

          if (hsl.saturation < 0.7) {
            c = setSaturation(0.7, c);
          }

          if (hsl.lightness < 0.3) {
            c = setLightness(0.5, c);
          }

          // return findColor(adjustHue(-30, c), v => v < 0.3, lighten);
          // return adjustHue(-30, c);
          return c;
        })
        .shuffle()
        // .flatMap(c => [c, adjustHue(random(15, 90), c)])
        .value();

      const colorStops = titleColor.concat([...titleColor].reverse());

      gradient = linearGradient({
        colorStops,
        toDirection: 'to right bottom'
      }).backgroundImage;
    } else {
      const colorStops = defaultCoverColors.concat([...defaultCoverColors].reverse());

      console.log('colorStops', colorStops);

      gradient = linearGradient({
        colorStops,
        toDirection: 'to right bottom'
      }).backgroundImage;
    }

    console.log({ gradient })

    setTitleBg(gradient.toString() ?? '');
  }, [cover]);

  useEffect(() => {
    const tags = trackPlay?.track?.extra?.tags;

    setTitleText((tags ? formatTags(tags) : '')|| '');
  }, [trackPlay?.track?.extra?.tags]);

  useEffect(() => {
    const overrides = {
      overflow: 'hidden',
      'font-size': 'calc(100cqh / 30)'
    }

    const saved: Partial<Record<string, string>> = {};

    for (const [prop, value] of Object.entries(overrides)) {
      saved[prop] = document.body.style[prop as any];
      document.body.style[prop as any] = value;
    }

    return () => {
      for (const prop of Object.keys(overrides)) {
        const value = saved[prop];

        if (value !== undefined) {
          document.body.style[prop as any] = value;
        }
      }
    }
  }, []);

  const colors = useMemo(() => {
    if (coverProps.colors.length < 6) {
      return undefined;
    }

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

  }, [coverProps.colors]);

  const lyrics = trackPlay?.track?.extra?.coverAndLyrics?.lyrics;

  const simple = !!titleText && !cover && !lyrics?.timeline?.length;

  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      <Control>
        <Button onClick={() => client.playAudio(stationId) }>
          Listen
        </Button>
        <Button onClick={() => client.karaokeEnabled = !client.karaokeEnabled }>
          Karaoke
        </Button>
      </Control>
      <Cover { ...coverProps } />

      <Lyrics
        stationId={stationId}
        deckIndex={activeDeck}
        lineHeight={1.8}
        lines={8}
        colors={colors}
      />
      {/* TODO: Use ref to change bg */}
      <Title text={titleText} bg={titleBg} center={simple} />
      <PlayHead
        stationId={stationId}
        deckIndex={activeDeck}

        backgroundColor={colors?.background ?? defaultLyricsColors.background}
        textColor={colors?.line?.text ?? defaultLyricsColors.line.text}
        activeColor={colors?.line?.active ?? defaultLyricsColors.line.active}
      />
    </div>
  )
}
