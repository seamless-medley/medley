import { chain, random, sumBy } from "lodash";
import { Ref, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Flex, Group, type MantineStyleProps, Stack, Text, Title as TextTitle } from "@mantine/core";
import { useFullscreen, useSetState } from "@mantine/hooks";

import {
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
import { AnimatePresence, motion, MotionNodeOptions } from "motion/react";
import { AutoScroller } from "@ui/components/AutoScoller";
import { IconHeadphones } from "@tabler/icons-react";
import { usePlayingStationId } from "@ui/hooks/useClient";
import classes from './PlayPage.module.css';

const defaultCoverColors = [rgb(182, 244, 146), rgb(51, 139, 147)];

const logger = getLogger(['ui', 'page', 'play']);

type StationProps = {
  stationId: string;
}

const StationName: React.FC<StationProps> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');

  return (
    <AutoScroller>
      <TextTitle textWrap='nowrap' order={2}>{name}</TextTitle>
    </AutoScroller>
  );
}

const StationDescription: React.FC<StationProps> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const description = useRemotableProp(station, 'description');

  return (
    <AutoScroller>
      <TextTitle textWrap='nowrap' order={5}>{description}</TextTitle>
    </AutoScroller>
  );
}

const StationTrack: React.FC<StationProps> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck');
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');
  const tags = trackPlay?.track?.extra?.tags;

  return (
    <AutoScroller>
      <TextTitle textWrap='nowrap' order={4}>{tags ? formatTags(tags) : undefined}</TextTitle>
    </AutoScroller>
  );
}

const animatePresenceProps: Pick<MotionNodeOptions, 'initial' | 'exit' | 'animate' | 'transition'> = {
  initial: { opacity: 0 },
  exit: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.6, ease: 'easeInOut' }
}

const StationCover: React.FC<{ cover?: string }> = ({ cover }) => {
  return (
    <AnimatePresence>
      {cover
        ? <Box component={motion.div}
            key={cover}
            pos='absolute' left={0} top={0} right={0} bottom={0}
            style={{
              backgroundImage: `url(${cover})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
            {...animatePresenceProps}
          />
        : <Flex component={motion.div} justify='center' align='center'
            pos='absolute' left={0} top={0} right={0} bottom={0}
          >
            <Text
              component={motion.div}
              key='no_cover'
              fz='2.5rem'
              initial={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 3 }}
              style={{ userSelect: 'none' }}
            >
              No cover
            </Text>
          </Flex>
        }
    </AnimatePresence>
  );
}

type StationLyricsProps = StationProps & {
  colors: string[];
  showTitle?: boolean;
  showCover?: boolean;
  showPlayhead?: boolean;
}

const StationLyrics: React.FC<StationLyricsProps> = ({ stationId, showTitle, showCover, showPlayhead, colors: colorsProp }) => {
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

  useEffect(() => {
    const colorTable = colorsProp.map(c => [parseToHsl(c), c] as const);
    const avgLightness =  sumBy(colorTable, ([hsl]) => hsl.lightness) / colorTable.length;

    setCoverProps({
      colors: chain(colorTable)
        .map(([hsl, c]) => {
          if (hsl.hue <= 4 && hsl.lightness < 0.1) {
            c = setLightness(avgLightness * 0.6, c);
          }

          return [hsl, c] as const;
        })
        .sortBy(([hsl, c]) => hsl.hue)
        .map(([hsl, c]) => c)
        .value(),
      url: cover,
      center: (lyrics ? lyrics.timeline.length : 2) < 2,
      uuid: trackPlay?.uuid ?? ''
    });
  }, [cover, colorsProp, trackPlay?.uuid])

  useEffect(() => {
    let gradient;

    if (colorsProp.length) {
      const titleColor = colorsProp.map(c => {
          const hsl = parseToHsl(c);

          if (hsl.saturation < 0.7) {
            c = setSaturation(0.7, c);
          }

          if (hsl.lightness < 0.7) {
            c = setLightness(0.7, c);
          }

          return c;
        });

      const colorStops = titleColor.concat([...titleColor].reverse());

      gradient = linearGradient({
        colorStops,
        toDirection: 'to right bottom'
      }).backgroundImage;
    } else {
      const colorStops = defaultCoverColors.concat([...defaultCoverColors].reverse());

      gradient = linearGradient({
        colorStops,
        toDirection: 'to right bottom'
      }).backgroundImage;
    }

    setTitleBg(gradient.toString() ?? '');
  }, [colorsProp]);

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
    if (colorsProp.length < 6) {
      return undefined;
    }

    const [background, dim, text, shadow, active, glow] = colorsProp;

    return {
      background: setLightness(0.01, background),
      line: {
        text: setLightness(0.3, text),
        active: setLightness(1, active),
        dim: setLightness(0.2, dim),
        shadow: setLightness(0.5, shadow),
        glow: setLightness(0.8, glow)
      }
    }

  }, [colorsProp]);

  const lyrics = trackPlay?.track?.extra?.coverAndLyrics?.lyrics;

  const simple = !!titleText && !cover && !lyrics?.timeline?.length;

  return (
    <Box pos='relative' w='100%' h='100%' style={{ overflow: 'hidden' }}>
      {/* <Control>
        <Button onClick={() => client.playAudio(stationId) }>
          Listen
        </Button>
        <Button onClick={() => client.karaokeEnabled = !client.karaokeEnabled }>
          Karaoke
        </Button>
      </Control> */}

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
          alternateColor={colors?.line?.dim ?? defaultLyricsColors.line.active}
        />
      }
    </Box>
  )
}

type StationLyricsPanelProps = StationProps & {
  fullscreen: boolean;
  colors: string[];
}

const StationLyricsPanel: React.FC<StationLyricsPanelProps>   = ({ stationId, fullscreen, colors }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck');

  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');
  const hasLyrics = (trackPlay?.track?.extra?.coverAndLyrics?.lyrics?.timeline?.length ?? 0) > 4;

  return (
    <>
      <StationLyrics
        colors={colors}
        stationId={stationId}
        showTitle={fullscreen}
        showPlayhead={fullscreen}
        showCover={fullscreen}
      />
      <AnimatePresence>
        {!hasLyrics && !fullscreen &&
          <Flex component={motion.div}
            pos='absolute'
            bg='rgb(0 0 0 / 0.9)'
            top={0} bottom={0} left={0} right={0} justify='center' align='center'
            fz='2.5rem'
            style={{ userSelect: 'none' }}
            {...animatePresenceProps}
          >
            No lyrics
          </Flex>
        }
      </AnimatePresence>
    </>
  );
}

type StationCoverAndLyricsProps = {
  stationId: string;
  toggleFullscreen: () => any;
  fullscreen: boolean;
  lyricsRef: Ref<HTMLDivElement>;
}

const StationCoverAndLyrics: React.FC<StationCoverAndLyricsProps> = ({ lyricsRef: ref, toggleFullscreen: toggle, stationId, fullscreen }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck');
  const cover = useDeckCover(stationId, activeDeck);

  const [colors, setColors] = useState<string[]>([]);

  const createColors = useCallback(async () => cover
    ? (await prominent(cover, { format: 'hex', amount: 6, group: 30, sample: 24 })) as string[]
    : chain(6).times().map(i => adjustHue((i - 3) * random(15, 20), hsl(random(360), random(0.5, 0.9, true), random(0.6, 0.8, true)))).value()
  , [cover]);

  useEffect(() => void createColors().then(setColors), [cover]);

  const panelWidth: MantineStyleProps['w'] = {
    base: '100%',
    md: '50%'
  };

  const panelHeight: MantineStyleProps['h'] = {
    base: '50cqh',
    md: '100%'
  };

  return (
    <Flex
      className={classes.stationCoverAndLyrics}
      direction={{ base: 'column', md: 'row' }}
      w={{ base: '95%', md: '95%', lg: '75%' }}
      h={{ base: '100%', md: '60cqh', lg: '70cqh'  }}
      mih='50cqh'
      align='center'
      justify='center'
      bdrs='lg'
      bg={`linear-gradient(black) padding-box, conic-gradient(from var(--angle), ${[...colors, ...[...colors].reverse()].join(', ')}) border-box`}
      onDoubleClick={toggle}
    >
      <Box
        pos='relative'
        w={panelWidth}
        h={panelHeight}
      >
        <StationCover cover={cover} />
      </Box>

      <Box ref={ref}
        pos='relative'
        w={panelWidth}
        h={panelHeight}
      >
        <StationLyricsPanel {...{ stationId, fullscreen, colors }} />
      </Box>
    </Flex>
  )
}

export const PlayPage: React.FC = () => {
  const { station: stationId } = Route.useParams();
  const { toggle, fullscreen, ref } = useFullscreen();

  const playingStation = usePlayingStationId();
  const isListening = playingStation === stationId;
  const listenClickHandler = !isListening
    ? () => client.playAudio(stationId)
    : () => client.stopAudio();

  return (
    <>
      <Stack align="center">
        <Stack w='100%' mih='4em' gap='xs' justify="center">
          <Group justify='center' w='100%'>
            <StationName stationId={stationId} />
          </Group>

          <Group justify='center' w='100%'>
            <StationDescription stationId={stationId} />
          </Group>

          <Group justify='center' w='100%' mih='1em'>
            <StationTrack stationId={stationId} />
          </Group>
        </Stack>

        <Group mb='lg'>
          <Button bdrs={'lg'} onClick={listenClickHandler}>
            <IconHeadphones />{isListening ? 'Listening' : 'Listen'}
          </Button>

          <Button variant="outline" bdrs={'lg'} onClick={() => { toggle(); client.playAudio(stationId)} }>Fullscreen</Button>
        </Group>

        <StationCoverAndLyrics
          fullscreen={fullscreen}
          toggleFullscreen={toggle}
          stationId={stationId}
          lyricsRef={ref}
        />
      </Stack>
    </>
  )
}
