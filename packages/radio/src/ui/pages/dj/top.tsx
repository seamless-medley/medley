import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Center,  Flex, HoverCard, Image, Stack, Text, TextProps, Tooltip, rem } from "@mantine/core";
import { IconPlayerPause, IconPlayerPlayFilled, IconPlayerTrackNext, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import TextTransition, { presets, TextTransitionProps } from 'react-text-transition';

import { VUBar } from "../../components";
import { theme } from "../../theme/theme";
import { useRemotableProp } from "../../hooks/remotable";
import { useDeck, useDeckInfo } from "../../hooks/useDeck";

import { useStation } from "../../hooks/useStation";
import { client } from "../../init";
import { usePlayingStationId } from "../../hooks/useClient";
import { useElementSize, useMove } from "@mantine/hooks";

type TransitionTextProps = PropsWithChildren<TextProps & TextTransitionProps> & {
  component?: any;
};

const TransitionText: React.FC<TransitionTextProps> = React.memo((props) => {
  const {
    children,
    direction, inline, delay, springConfig, style, translateValue,
    ...textProps
  } = props;

  const transitionProps = { direction, inline, delay, springConfig, style, translateValue };

  return (
    <TextTransition {...transitionProps}>
      <Text {...textProps}>
        {children}
      </Text>
    </TextTransition>
  )
});

const VolumeControl: React.FC<{ height: number }> = ({ height }) => {
  // const { ref } = useMove(({ y }));

  return (
    <Box h={height} style={{ width: '5px', backgroundColor: 'red' }}>

    </Box>
  )
}

type StationIdProps = {
  stationId: string;
}

const StationBanner: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');
  const description = useRemotableProp(station, 'description');

  const audienceCount = 0 + (useRemotableProp(station, 'audienceCount') ?? 0);
  const prevAudienceCount = useRef(0);

  useEffect(() => {
    return station?.addPropertyChangeListener('audienceCount', (n, o) => {
      prevAudienceCount.current = o;
    });
  }, [station]);

  const playingStationId = usePlayingStationId();

  const elementSize = useElementSize();

  const [textAlignmentStyle] = useState<any>({ textAlign: 'center' });

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
            gradient={{ from: '#FFF638', to: '#38FFF6', deg: -45 }}
            style={textAlignmentStyle}
            truncate="end"
          >
            {name}
          </Text>

          <Text
            w="100%"
            h="1.2em"
            size="1.2em"
            px={16}
            style={textAlignmentStyle}
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

      <HoverCard position="top">
        <HoverCard.Target>
          <Tooltip withArrow label={!isListening ? 'Listen' : 'Stop Listening'} position="bottom">
            <ActionIcon
              aria-label="Listen"
              variant="outline"
              size={"32px"}
              color="white"
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
        </HoverCard.Target>
        <HoverCard.Dropdown p={0} m={0} bg={"red"} style={{ border: 0 }}>
          <VolumeControl height={elementSize.height - 32 - 16 - 4 } />
        </HoverCard.Dropdown>
      </HoverCard>
    </Flex>
  )
});

const DeckBanner: React.FC<{ deckIndex: number }> = React.memo(({ deckIndex }) => (
  <Box
    c={theme.white}
    style={{
      writingMode: 'vertical-lr',
      userSelect: 'none',
      textAlign: 'center',
      textTransform: 'uppercase',
      fontWeight: 'bold',
      backgroundImage: 'linear-gradient(to bottom, #fc466b, #3f5efb)'
    }}
  >
    <Text display="inline-block" h="5ch" fw="bold">
      Deck
    </Text>
    <TransitionText inline span
      display="inline-block"
      h="1ch"
      direction={deckIndex > 0 ? 'up' : 'down' }
      fw="bold"
    >
      {deckIndex !== undefined ? deckIndex + 1 : '?'}
    </TransitionText>
  </Box>
));

const Cover: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const { info, cover } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  return (
    <Box component={motion.div}
      style={{ aspectRatio: 1, zIndex: 10, overflow: 'visible' }}
      whileHover={{
        scale: 1.5,
        boxShadow: '0px 0px 34px 0px var(--mantine-color-dark-6)',
        transition: { duration: 0.4, delay: 0.2  }
      }}
    >
      <AnimatePresence mode="wait">
        <Image component={motion.img}
          key={info.trackPlay?.uuid}
          src={cover}
          h="100%"
          fit="cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      </AnimatePresence>
    </Box>
  )
});

const ActiveDeck: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  return (
    <Flex>
      <DeckBanner deckIndex={activeDeck} />
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

const PlayHead: React.FC<StationIdProps> = React.memo(({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  const { deck } = useDeck(stationId, activeDeck);

  const [time, setTime] = useState(0);

  const handlePosChange = useCallback((pos: number) => {
    setTime(Math.trunc(pos));
  }, [deck]);

  useEffect(() => {
    if (!deck) {
      return;
    }

    setTime(deck.cp());

    return deck.addPropertyChangeListener('cp', handlePosChange);
  }, [deck]);

  const mm = Math.trunc(time / 60).toString();
  const ss = Math.trunc(time % 60).toString();

  const textProps = {
    span: true,
    display: "inline-block",
    fw: 700,
    size: "1.8em",
    w: "1ch"
  }

  return (
    <Box c="violet.9">
      {mm.padStart(2, '0').split('').map((c, index) => (
        <Text {...textProps} key={index} style={{ textAlign: 'center', userSelect: 'none' }}>
          {c}
        </Text>
      ))}

      <Text
        {...{...textProps, w: '0.5ch' }}
        style={{ transform: 'translateY(-2.5px)', textAlign: 'center', userSelect: 'none' }}
      >
        :
      </Text>

      {ss.padStart(2, '0').split('').map((c, index) => (
        <Text {...textProps} key={index} style={{ textAlign: 'center', userSelect: 'none' }}>
          {c}
        </Text>
      ))}
    </Box>
  )
});

const TrackInfo: React.FC<StationIdProps> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const { info: { trackPlay } } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const [nowrapStyle] = useState<any>({ textWrap: 'nowrap' });
  const title = trackPlay?.track?.extra?.tags?.title;
  const artist = trackPlay?.track?.extra?.tags?.artist;

  return (
    <Flex direction="column">
      <TransitionText
        size="1.5em"
        h="1.5em"
        truncate="end"
        fw={600}
        style={nowrapStyle}
        delay={400}
        springConfig={presets.wobbly}
      >
        {title}
      </TransitionText>

      <TransitionText
        size="1.4em"
        h="1.4em"
        truncate="end"
        style={nowrapStyle}
        delay={500}
        springConfig={presets.wobbly}
      >
        {artist}
      </TransitionText>
    </Flex>
  )
}

export const TopBar: React.FC<StationIdProps> = ({ stationId }) => {
  console.log('TopBar');

  return (
    <>
      <Flex
        h="100%"
        bg="linear-gradient(45deg, #FA8BFF 0%, #2BD2FF 52%, #2BFF88 90%)"
        c="dark.7"
      >
        <StationBanner stationId={stationId} />
        <VUBar orientation="vertical" size={12} />
        <ActiveDeck stationId={stationId} />

        <Flex direction="column" justify="space-evenly" pl={10}>
          <TrackInfo stationId={stationId} />
          <PlayHead stationId={stationId} />
          <TransportControl stationId={stationId} />
        </Flex>
      </Flex>
    </>
  )
}
