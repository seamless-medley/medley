import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import {
  Container,
  Title,
  Text,
  Grid,
  Card,
  Group,
  Stack,
  Badge,
  Center,
  ThemeIcon,
  AppShell,
  Box
} from '@mantine/core';

import { IconMusic, IconRadio, IconHeadphones } from '@tabler/icons-react';

import { useSurrogate } from "@ui/hooks/surrogate";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useStation } from "@ui/hooks/useStation";
import { PlayRoute } from "@ui/pages/play/PlayPage/route";
import { LyricsBar } from "@ui/components/LyricsBar";
import { PlayHeadText } from "@ui/components/PlayHeadText";

import { NavBar } from "./components/NavBar";
import { useDeckMetaData } from "@ui/hooks/useDeck";
import { TransitionText } from "@ui/components/TransitionText";
import { formatTags } from "@seamless-medley/utils";

const Hero: React.FC<{ instanceName?: string }> = ({ instanceName = 'Medley' }) => {
  return (
    <Center mb={80}>
      <Stack align="center" gap="xl">
        <Group align="center" gap="lg">
          <ThemeIcon
            size={80}
            radius="xl"
            variant="gradient"
            gradient={{ from: 'pink', to: 'violet', deg: 45 }}
          >
            <IconMusic size={40} />
          </ThemeIcon>
          <Title
            size={60}
            fw={900}
          >
            {instanceName}
          </Title>
        </Group>
      </Stack>
    </Center>
  )
}

const StationCard: React.FC<{ stationId: string }> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const tags = useDeckMetaData(stationId, activeDeck);

  return (
    <Link to={PlayRoute.fullPath} params={{ station: stationId }}>
      <Card
        shadow="md"
        radius="lg"
        withBorder
        style={{
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          textDecoration: 'none',
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Group align="center" gap="sm">
              <ThemeIcon
                size="md"
                radius="md"
                variant="gradient"
                gradient={{ from: 'green', to: 'teal', deg: 45 }}
              >
                {/* <IconPlay size={16} /> */}
              </ThemeIcon>
              <Title order={4} fw={600}>
                {station?.name() || stationId}
              </Title>
            </Group>
            <Group align="center" gap="xs">
              <PlayHeadText
                stationId={stationId}
                deckIndex={activeDeck}
                size="xs"
                c="dimmed"
              />
            </Group>
          </Group>

          <Stack gap="xs">
            <Box style={{ minHeight: '1.2em' }}>
              <Text size="sm" c="dimmed">
                {station?.description?.() ?? ''}
              </Text>
            </Box>

             <Box style={{ minHeight: '1.5em', marginTop: '0.25rem' }}>
              <TransitionText>
                {tags ? formatTags(tags) : undefined}
              </TransitionText>
            </Box>

            <Box style={{ minHeight: '1.5em', marginTop: '0.25rem' }}>
              <LyricsBar stationId={stationId} />
            </Box>
          </Stack>
        </Stack>
      </Card>
    </Link>
  );
};

const StationList = () => {
  const { surrogate: $global } = useSurrogate('global', '$');

  useEffect(() => {
    if (!$global) {
      return;
    }

    $global.getStations().then(setStations);
  }, [$global]);

  const [stations, setStations] = useState<string[]>([]);

  return (
    <Stack gap="xl" mb={80}>
      <Group justify="center" align="center" gap="md">
        <IconRadio size={32} color="var(--mantine-color-green-6)" />
        <Title order={2} size="h1" fw={700}>
          Stations
        </Title>
      </Group>

      {stations.length > 0 ? (
        <Grid>
          {stations.map((stationId) => (
            <Grid.Col key={stationId} span={{ base: 12, sm: 6, lg: 4 }}>
              <StationCard stationId={stationId} />
            </Grid.Col>
          ))}
        </Grid>
      ) : (
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
      )}
    </Stack>
  )
}

export const HomePage = () => {
  const { surrogate: $global } = useSurrogate('global', '$');
  const instanceName = useRemotableProp($global, 'instanceName');

  return (
    <AppShell header={{ height: 60 }}>
      <NavBar onDJModeClick={() => undefined} />
      <AppShell.Main>
        <Container size="xl" py={60}>
          <Hero instanceName={instanceName} />
          <StationList />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
