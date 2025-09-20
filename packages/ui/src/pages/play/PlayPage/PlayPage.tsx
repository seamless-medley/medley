import { chain, random, sortBy } from "lodash";
import { useCallback, useEffect, useMemo, useState } from "react";

import { styled } from "@linaria/react";
import { Box, Button, Container, Flex, Group, Image, Stack } from "@mantine/core";
import { useFullscreen, useSetState } from "@mantine/hooks";

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

import { prominent } from 'color.js'

import { formatTags } from "@seamless-medley/utils";

import { getLogger } from "@logtape/logtape";

import { useDeckCover, useDeckInfo } from "@ui/hooks/useDeck";
import { useStation } from "@ui/hooks/useStation";
import { useRemotableProp } from "@ui/hooks/remotable";

import { client } from "@ui/init";

import { Cover, CoverProps } from "./components/Cover";
import { Title } from "./components/Title";
import { Lyrics, defaultColors as defaultLyricsColors } from "./components/Lyrics";
import { PlayHead } from "./components/PlayHead";

import { Route } from "./route";
import { AnimatePresence, motion } from "motion/react";

const defaultCoverColors = [rgb(182, 244, 146), rgb(51, 139, 147)];

function findColor(base: string, predicate: (c: string) => boolean, fn: (deg: number, base: string) => string) {
  let deg = 0.1;
  let c = base;
  while (deg <= 360 && predicate(c)) {
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

const logger = getLogger(['ui', 'page', 'play']);

type StationLyricsProps = {
  stationId: string;
  showTitle?: boolean;
  showCover?: boolean;
  showPlayhead?: boolean;
}

const StationLyrics: React.FC<StationLyricsProps> = ({ stationId, showTitle, showCover, showPlayhead }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck');

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

  const createColors = useCallback(async () => sortColors(cover
    ? (await prominent(cover, { format: 'hex', amount: 6 })) as string[]
    : chain(6).times().map(i => adjustHue((i - 3) * random(15, 20), hsl(random(360), random(0.5, 0.9, true), random(0.6, 0.8, true)))).value()
  ), [cover]);

  useEffect(() => void createColors().then((colors) => {
    setCoverProps({
      colors,
      url: cover,
      center: (lyrics ? lyrics.timeline.length : 2) < 2,
      uuid: trackPlay?.uuid ?? ''
    });
  }), [cover]);

  useEffect(() => {
    let gradient;

    logger.debug('Colors {colors}', { colors: coverProps.colors });

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

      logger.info('colorStops {colorStops}', { colorStops });

      gradient = linearGradient({
        colorStops,
        toDirection: 'to right bottom'
      }).backgroundImage;
    }

    setTitleBg(gradient.toString() ?? '');
  }, [coverProps.colors]);

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
      background: findColor(background, v => getLuminance(v) >= 0.01, darken),
      line: {
        text: findColor(findColor(text, v => getLuminance(v) >= 0.045, darken), v => getLuminance(v) < 0.0095, tint),
        active: findColor(active, v => getLuminance(v) < 0.9, tint),
        dim: findColor(dim, v => getLuminance(v) >= 0.03, shade),
        shadow: findColor(shadow, v => getLuminance(v) >= 0.11, shade),
        glow: findColor(glow, v => getLuminance(v) < 0.97, lighten)
      }
    }

  }, [coverProps.colors]);

  const lyrics = trackPlay?.track?.extra?.coverAndLyrics?.lyrics;

  const simple = !!titleText && !cover && !lyrics?.timeline?.length;

  return (
    <Box pos='relative' w='100%' h='100%' style={{ overflow: 'hidden' }}>
      <Control>
        <Button onClick={() => client.playAudio(stationId) }>
          Listen
        </Button>
        <Button onClick={() => client.karaokeEnabled = !client.karaokeEnabled }>
          Karaoke
        </Button>
      </Control>

      <Cover { ...coverProps } visible={showCover} />

      <Lyrics
        stationId={stationId}
        deckIndex={activeDeck}
        lineHeight={1.8}
        lines={8}
        colors={colors}
      />

      <Title text={titleText} bg={titleBg} center={simple} visible={showTitle} />

      { showPlayhead &&
        <PlayHead
          stationId={stationId}
          deckIndex={activeDeck}
          backgroundColor={colors?.background ?? defaultLyricsColors.background}
          textColor={colors?.line?.text ?? defaultLyricsColors.line.text}
          activeColor={colors?.line?.active ?? defaultLyricsColors.line.active}
        />
      }
    </Box>
  )
}

export const PlayPage: React.FC = () => {
  const { station: stationId } = Route.useParams();

  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck');
  const cover = useDeckCover(stationId, activeDeck);

  const { toggle, fullscreen, ref } = useFullscreen();

  return (
      <Stack
        pos='fixed'
        gap='sm'
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          height: '50%',
          width: '50%',
          // outline: '1px solid yellow'
          overflow: 'hidden',
        }}
      >
        <Group
          style={{ width: '100%', height: '100%', overflow: 'hidden' }}
          wrap="nowrap"
          bdrs='lg'
          gap={0}
          onDoubleClick={toggle}
        >
          <Box w='50%' h='100%'>
            <Image component={motion.img}
              key={cover}

              src={cover}
              initial={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              animate={{ opacity: 1}}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
            />
          </Box>
          <Box ref={ref} pos='relative' w='50%' h='100%'>
            <StationLyrics
              stationId={stationId}
              showTitle={fullscreen}
              showPlayhead={fullscreen}
              showCover={fullscreen}
            />
          </Box>
        </Group>

        <Button bdrs={'lg'} onClick={toggle}>Fullscreen</Button>
      </Stack>
  )
}
