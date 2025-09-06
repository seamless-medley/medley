import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Center, Flex, Image, Stack, Text, Tooltip, rem } from "@mantine/core";
import { useElementSize, useId, useMove } from "@mantine/hooks";
import { IconPlayerPause, IconPlayerPlayFilled, IconPlayerTrackNext, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { adjustHue, hsl, linearGradient, setLightness, transparentize } from "polished";
import { AnimatePresence, motion } from "framer-motion";
import { config as springConfig } from '@react-spring/web';

import { random, take, zip } from "lodash";

import { useRemotableProp } from "@ui/hooks/remotable";
import { usePlayingStationId } from "@ui/hooks/useClient";
import { useStation } from "@ui/hooks/useStation";
import { useDeckCover, useDeckInfo } from "@ui/hooks/useDeck";
import { client } from "@ui/init";

import { PlayHeadText } from "@ui/components/PlayHeadText";
import { TransitionText } from "@ui/components/TransitionText";
import { LyricsBar } from "@ui/components/LyricsBar";

import { VUBar } from "./VUBar";
import { DeckBanner } from "./DeckBanner";

const VolumeControl: React.FC<{ color: string }> = ({ color }) => {
  const [gain, setGain] = useState(client.volume);

  const { ref } = useMove(({ y }) => {
    const v = 1 - y;
    client.volume = v;
  });

  useEffect(() => {
    client.on('volume', setGain);

    return () => {
      client.off('volume', setGain);
    }
  }, [client.volume]);

  const borderRadius = '1000px';
  const w = 8;
  const tw = w * 1.75;
  const thumbAlign = (tw - w) / 2;

  return (
    <Box ref={ref} h="100%" style={{ width: w, backgroundColor: 'rgb(0 0 0 / 0.2)', borderRadius }}>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          height: `${gain * 100}%`,
          width: '100%',
          borderRadius,
          backgroundColor: transparentize(0.5, color),
          transition: 'background-color 2s ease'
        }}
      />

      <div
        style={{
          position: 'absolute',
          bottom: `calc(${gain * 100}% - ${tw}px)`,
          width: tw,
          height: tw,
          borderRadius,
          backgroundColor: color,
          transform: `translate(-${thumbAlign}px, -${tw / 2}px)`,
          transition: 'background-color 2s ease'
        }}
      />
    </Box>
  )
}

type StationIdProps = {
  stationId: string;
}

const StationBanner: React.FC<StationIdProps & { colors: string[] }> = React.memo(({ stationId, colors }) => {
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');
  const description = useRemotableProp(station, 'description');

  const prevAudienceCount = useRef(0);

  useEffect(() => {
    return station?.addPropertyChangeListener('audienceCount', (n, o) => {
      prevAudienceCount.current = o;
    });
  }, [station]);
  const audienceCount = useRemotableProp(station, 'audienceCount', 0);

  const playingStationId = usePlayingStationId();

  const elementSize = useElementSize();

  const toggleListen = useCallback(() => {
    if (!station) {
      return;
    }

    if (client.playingStationId === stationId) {
      client.stopAudio();
    } else {
      client.playAudio(stationId);
    }
  }, [station, stationId]);

  const isListening = (playingStationId !== undefined) && (playingStationId === stationId);
  const iconStroke = 1.2;

  return (
    <Flex ref={elementSize.ref} pos="relative" miw={300} maw={300}>
      <Center w="100%">
        <Stack align="center" style={{ overflow: 'clip' }}>
          <Text
            w="100%"
            h="2em"
            size="2em"
            px={16}
            fw={900}
            variant="gradient"
            gradient={{ from: colors[0] ?? '#FFF638', to: colors[1] ?? '#38FFF6', deg: -45 }}
            style={{ textAlign: 'center' }}
            truncate="end"
          >
            {name}
          </Text>

          <Text
            w="100%"
            h="1.2em"
            size="1.2em"
            px={16}
            style={{ textAlign: 'center' }}
            truncate="end"
          >
            {description}
          </Text>

          <Box>
            {audienceCount.toString().split('').map((c, index) => (
              <TransitionText key={index}
                inline span
                direction={audienceCount > prevAudienceCount.current ? 'up' : 'down'}
                translateValue="50%"
                fw="bold"
                w="1ch"
                display="inline-block"
                style={textAlignmentStyle}
              >
                {c}
              </TransitionText>
            ))}

            <Text span ml={4}>Listeners</Text>
          </Box>
        </Stack>
      </Center>

      <Tooltip withArrow label={!isListening ? 'Listen' : 'Stop Listening'} position="bottom">
        <ActionIcon
          aria-label="Listen"
          variant="outline"
          size={"32px"}
          color={colors[1]}
          pos="absolute"
          m={4}
          bottom={0}
          right={0}
          onClick={toggleListen}
        >
          {!isListening
            ? <IconVolume stroke={iconStroke} />
            : <IconVolumeOff stroke={iconStroke} />
          }
        </ActionIcon>
      </Tooltip>

      <Box pos="absolute" h={elementSize.height - 32 - 16 - 16 } top={16} right={16}>
        <VolumeControl color={colors[1]} />
      </Box>

    </Flex>
  )
});

const Cover: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const info = useDeckInfo(stationId, activeDeck, 'trackPlay');
  const cover = useDeckCover(stationId, activeDeck);
  const uid = useId();

  return (
    <Box component={motion.div}
      style={{ aspectRatio: 1, zIndex: 10, overflow: 'visible' }}
      whileHover={{
        scale: 1.6,
        boxShadow: '0px 0px 34px 0px var(--mantine-color-dark-6)',
        transition: { duration: 0.4, delay: 0.2  }
      }}
    >
      <AnimatePresence mode="wait">
        <Image component={motion.img}
          key={`${info.trackPlay?.uuid}`}
          src={cover}
          h="100%"
          fit="cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          fallbackSrc="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        />
      </AnimatePresence>
    </Box>
  )
});

const ActiveDeck: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  return (
    <Flex pos="relative">
      <Box w={24}>
        <DeckBanner deckIndex={activeDeck} />
      </Box>
      <Cover stationId={stationId} />
    </Flex>
  );
});

const TransportControl: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const playState = useRemotableProp(station, 'playState');

  const play = useCallback(() => {
    if (!station) {
      return;
    }

    station.start();
    client.playAudio(stationId);
  }, [station, stationId]);

  const iconSize = rem(44);
  const iconStroke = 1.2;

  return (
    <ActionIcon.Group>
      <ActionIcon
        aria-label="Play"
        variant="filled"
        disabled={playState === 'playing'}
        size={iconSize}
        color='green.8'
        onClick={play}
      >
        <IconPlayerPlayFilled stroke={iconStroke} />
      </ActionIcon>

      <ActionIcon
        aria-label="Pause"
        variant="filled"
        disabled={playState === 'paused'}
        size={iconSize}
        color="yellow.5"
        onClick={() => station?.pause()}
      >
        <IconPlayerPause stroke={iconStroke} />
      </ActionIcon>

      <Tooltip withArrow label="Skip to next track" position="right">
        <ActionIcon
          aria-label="Skip"
          variant="filled"
          size={iconSize}
          color="red.8"
          onClick={() => station?.skip()}
        >
          <IconPlayerTrackNext stroke={iconStroke} />
        </ActionIcon>
      </Tooltip>
    </ActionIcon.Group>
  )
});

const TrackInfo: React.FC<StationIdProps> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const title = trackPlay?.track?.extra?.tags?.title;
  const artist = trackPlay?.track?.extra?.tags?.artist;

  return (
    <Flex direction="column">
      <TransitionText
        size="1.5em"
        h="1.5em"
        truncate="end"
        fw={600}
        delay={400}
        springConfig={springConfig.wobbly}
        nowrap
      >
        {title}
      </TransitionText>

      <TransitionText
        size="1.4em"
        h="1.4em"
        truncate="end"
        delay={500}
        springConfig={springConfig.wobbly}
        nowrap
      >
        {artist}
      </TransitionText>
    </Flex>
  )
}

function makeColorStops(colors: string[], stops: number[]) {
  const count = Math.min(colors.length, stops.length);
  return zip(take(colors, count), take(stops, count)).map(([c, s]) => `${c} ${s!.toFixed(2)}%`);
}

async function generateColors() {
  const a = random(0, 360);
  const b = a + random(45, 120);
  const c = a - random(45, 120);
  const lightness = random(0.75, 0.82, true);
  return [a, b, c].map(v => hsl(v % 360, 1, lightness));
}

export const TopBar: React.FC<StationIdProps> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  const [stationColors, setStationColors] = useState(['#FFF638', '#38FFF6']);

  const elRef = useRef<HTMLDivElement>(null);
  const altElRef = useRef<HTMLDivElement>(null);

  const alt = useRef(false);

  useEffect(() => {
    async function changeBg() {
      const colors = await generateColors()

      const bg = linearGradient({
        colorStops: makeColorStops(colors, [0, 52, 90]),
        toDirection: '45deg'
      }).backgroundImage as string

      (alt.current ? altElRef : elRef).current!.style.backgroundImage = bg;
      altElRef.current!.style.opacity = alt.current ? '1' : '0';
      alt.current = !alt.current;

      setStationColors([
        setLightness(0.36, adjustHue(120, colors[0])),
        setLightness(0.40, adjustHue(60, colors[0])),
      ]);
    }

    if (elRef.current && altElRef.current) {
      changeBg();
    }

  }, [activeDeck, elRef.current, altElRef.current]);

  return (
    <Flex ref={elRef}
      pos="relative"
      h="100%"
      c="dark.7"
      bg="linear-gradient(45deg, #FA8BFF 0%, #2BD2FF 52%, #2BFF88 90%)"
    >
      <Box ref={altElRef}
        w="100%"
        h="100%"
        pos="absolute"
        style={{ transition: 'opacity 2s ease', opacity: 0 }}
      />

      <StationBanner stationId={stationId} colors={stationColors} />
      <VUBar orientation="vertical" size={12} />
      <ActiveDeck stationId={stationId} />

      <Flex direction="column" justify="space-evenly" pl={10}>
        <TrackInfo stationId={stationId} />
        <Box >
          <PlayHeadText
            stationId={stationId}
            deckIndex={activeDeck}
            c="indigo.9"
            fw={700}
            size="1.8em"
          />
        </Box>

        <Flex direction="row" align="center" gap="md">
          <TransportControl stationId={stationId} />
          <LyricsBar stationId={stationId} inline />
        </Flex>
      </Flex>
    </Flex>
  )
}
