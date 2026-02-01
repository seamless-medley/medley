import { kebabCase } from "lodash";
import React, { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Center,
  ThemeIcon,
  Box,
  Button,
  alpha
} from '@mantine/core';

import { IconRadio, IconHeadphones } from '@tabler/icons-react';
import { adjustHue, darken, getLuminance, hsl, lighten, linearGradient } from "polished";
import { prominent } from "color.js";
import { AnimatePresence, motion } from "motion/react";
import { formatTags } from "@seamless-medley/utils";

import { useSurrogate } from "@ui/hooks/surrogate";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useStation } from "@ui/hooks/useStation";
import { useDeckCover, useDeckMetaData } from "@ui/hooks/useDeck";
import { usePlayingStationId } from "@ui/hooks/useClient";

import { LyricsBar } from "@ui/components/LyricsBar";
import { PlayHeadText } from "@ui/components/PlayHeadText";
import { TransitionText } from "@ui/components/TransitionText";

import { PlayRoute } from "@ui/pages/play/PlayPage/route";
import { client } from "@ui/init";

import { Route } from "./route";

import classes from './HomePage.module.css';
import { randomColors } from "@ui/utils";

const CoverBackdrop: React.FC<{ cover?: string }> = ({ cover }) => {
  const dimmer = linearGradient({
    toDirection: 'to bottom',
    colorStops: [
      'rgb(0 0 0 / 1) 0%',
      'transparent 30%',
      'transparent 60%',
      'rgb(0 0 0 / 1) 100%'
    ]
  }).backgroundImage.toString();

  return (
    <AnimatePresence>
      <Box component={motion.div}
        key={cover}
        pos='absolute' left={0} top={0} right={0} bottom={0}
        className={classes.cover}
        style={{
          backgroundImage: `${dimmer}, url(${cover})`,
          zIndex: 0
        }}
        initial={{ opacity: 0 }}
        exit={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      />
    </AnimatePresence>
  )
}

const StationIdent: React.FC<{ stationId: string }> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');
  const description = useRemotableProp(station, 'description');

  return (
    <Group p={0} align="flex-start" justify="space-between">
      <Stack gap={2} style={{ flex: 1 }} h={50}>
        <Title order={4} fw={600}>
          {name}
        </Title>
        <Text size="xs" c="gray.5">
          {description}
        </Text>
      </Stack>

      <ThemeIcon
        autoContrast
        size={60}
        radius="md"
        variant="outline"
        color="rgb(from white r g b / 0.8)"
      >
        {kebabCase(name).split('-', 2).map(word => word[0]).join('').toUpperCase()}
      </ThemeIcon>
    </Group>
  )
}

type Colors = {
  text: string;
  border: string;
  bg?: string;
}

const ButtonsBar: React.FC<{ stationId: string, colors: Colors }> = ({ stationId, colors }) => {
  const { station } = useStation(stationId);
  const audienceCount = useRemotableProp(station, 'audienceCount', 0);
  const playingStation = usePlayingStationId();

  const isListening = playingStation === stationId;
  const listenClickHandler = !isListening
    ? () => client.playAudio(stationId)
    : () => client.stopAudio();

  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <Group justify="space-between">
      <Group gap="xs">
        <Button variant="outline"
          size="xs"
          w={'9em'}
          style={{ transition: 'all 0.6s ease' }}
          bg={isListening ? colors.bg : undefined}
          c={isListening ? colors.text : 'white'}
          color={isListening ? colors.border : 'white'}
          onClick={listenClickHandler}
        >
          <IconHeadphones />{isListening ? 'Listening' : 'Listen'}
        </Button>

        <Button
          variant="outline" color="white" size="xs" onClick={() => navigate({ to: PlayRoute.fullPath, params: { station: stationId } })}>
          <IconRadio />View
        </Button>
      </Group>

      <Text size="xs">{audienceCount} Listeners</Text>
    </Group>
  )
}

const TrackBar: React.FC<{ stationId: string }> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const tags = useDeckMetaData(stationId, activeDeck);

  return (
    <Group justify="space-between" align="center" gap="xs">
      <Box style={{ flex: 1, minWidth: 0 }}>
        <TransitionText nowrap autoscroll>
          {tags ? formatTags(tags) : undefined}
        </TransitionText>
      </Box>
      <PlayHeadText
        stationId={stationId}
        deckIndex={activeDeck}
        size="xs"
        c="gray.3"
      />
    </Group>
  );
}

const StationCard: React.FC<{ stationId: string }> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;

  const { cover, colors: coverColors } = useDeckCover(stationId, activeDeck, {
    amount: 6,
    group: 40,
    sample: 30,
    getDefaultColors: () => randomColors(6)
  });

  const defaultColors: Colors = {
    text: '#fff',
    border: '#fff'
  }

  const { colors: buttonColor } = useDeckCover(stationId, activeDeck, {
    amount: 1,
    getDefaultColors: () => [defaultColors.text]
  });

  const isLight = buttonColor.length ? getLuminance(buttonColor[0]) > 0.3 : false;

  const colors: Colors = buttonColor.length ? ({
    text: isLight ? 'black' : 'white',
    bg: buttonColor[0],
    border: isLight ? darken(0.75, buttonColor[0]) : lighten(0.75, buttonColor[0])
  }): defaultColors;

  return (
    <Card
      withBorder
      shadow="md"
      radius="lg"
      h='100%'
      w='100%'
      bg={`linear-gradient(black) padding-box, conic-gradient(from var(--angle), ${[...coverColors, ...[...coverColors].reverse()].join(', ')}) border-box`}
      className={classes.card}
    >
      <CoverBackdrop cover={cover} />

      <Stack h="100%" style={{ justifyContent: 'space-between', zIndex: 1 }} c="white">
        <Stack gap="xs">
          <StationIdent stationId={stationId} />
          <ButtonsBar stationId={stationId} colors={colors} />
        </Stack>

        <Stack p={0} gap="xs">
          <LyricsBar stationId={stationId} nowrap autoscroll />
          <TrackBar stationId={stationId} />
        </Stack>
      </Stack>
    </Card>
  );
};

const NoStations = () => {
  return (
    <Card shadow="sm" radius="lg" withBorder p="xl">
      <Center py="xl">
        <Stack align="center" gap="md">
          <ThemeIcon size={80} radius="xl" variant="light" color="gray">
            <IconHeadphones size={40} />
          </ThemeIcon>
          <Title order={3} c="dimmed">
            No stations available
          </Title>
          <Text c="dimmed" ta="center">
            Check back later or contact your administrator
          </Text>
        </Stack>
      </Center>
    </Card>
  )
}

const StationList = () => {
  const [stations, setStations] = useState<string[]>([]);
  const { surrogate: $global } = useSurrogate('global', '$');

  useEffect(() => {
    if (!$global) {
      return;
    }

    $global.getStations().then(setStations);
  }, [$global]);

  return (
    <Stack gap="xl" my={80}>
      <Group justify="center" align="center" gap="md">
        <IconRadio size={32} color="var(--mantine-color-green-6)" />
        <Title order={2} size="h1" fw={700}>
          Stations
        </Title>
      </Group>

      {stations.length > 0
        ? (
          <Group justify="center">
            {stations.map((stationId, i) => (
              <Group
                key={i}
                w={{ base: '100%', sm: '80%', md: '65%', lg: '45%', xl: '40%' }}
                h='70cqh'
              >
                <StationCard key={i} stationId={stationId} />
              </Group>
            ))}
          </Group>
        )
        : <NoStations />
      }
    </Stack>
  )
}

export const HomePage = () => (
  <StationList />
);
