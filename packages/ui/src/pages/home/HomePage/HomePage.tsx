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
  AppShell
} from '@mantine/core';

import { IconMusic, IconRadio, IconHeadphones } from '@tabler/icons-react';

import { useSurrogate } from "@ui/hooks/surrogate";
import { useRemotableProp } from "@ui/hooks/remotable";
import { PlayRoute } from "@ui/pages/play/PlayPage/route";

import { NavBar } from "./components/NavBar";

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
                  <Stack gap="md">
                    <Group justify="space-between" align="flex-start">
                      <ThemeIcon
                        size="lg"
                        radius="md"
                        variant="gradient"
                        gradient={{ from: 'green', to: 'teal', deg: 45 }}
                      >
                        {/* <IconPlay size={20} /> */}
                      </ThemeIcon>
                      <Badge
                        variant="dot"
                        color="green"
                        size="sm"
                      >
                        LIVE
                      </Badge>
                    </Group>

                    <div>
                      <Title order={4} fw={600} mb={4}>
                        {stationId}
                      </Title>
                      <Text size="sm" c="dimmed">
                        Click to listen now
                      </Text>
                    </div>
                  </Stack>
                </Card>
              </Link>
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
