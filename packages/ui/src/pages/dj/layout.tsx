import { useEffect, useState } from 'react';
import { AppShell, Box, NavLink } from '@mantine/core'
import { createFileRoute, Link, Outlet, useMatchRoute, useParams } from '@tanstack/react-router'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { TopBar } from './components/TopBar';
import { DJConsoleRoute } from './DJConsolePage/route';
import { useStation } from '@ui/hooks/useStation';
import { TrackCollection } from '@seamless-medley/remote';
import { useRemotableProp } from '@ui/hooks/remotable';
import { CollectionRoute } from './CollectionPage/route';

const Sidebar = () => {
  const params = useParams({ strict: false });

  const { station } = useStation(params.station!);
  const currentCollection = useRemotableProp(station, 'currentCollection');

  const [collections, setCollections] = useState<TrackCollection[]>([]);

  useEffect(() => {
    if (!station) {
      return;
    }

    station.getCollections().then(setCollections);
  }, [station?.id]);

  const matchRoute = useMatchRoute();

  const match = matchRoute({ to: CollectionRoute.fullPath });
  const atCollection = match && match.collectionId !== undefined;

  return (
    <OverlayScrollbarsComponent>
      <NavLink
        activeOptions={{ exact: true }}
        component={Link}
        from={DJConsoleRoute.fullPath}
        to={DJConsoleRoute.to}
        label="Station"
      />

      <NavLink label="Collections" defaultOpened={atCollection}>
        {collections.map(({ id, description }) => (
            <NavLink
              key={id}
              component={Link}
              label={description}
              c={currentCollection === id ? 'green.5' : undefined}
              fw={currentCollection === id ? 'bold' : undefined}
              style={{ transition: 'all 1s ease' }}
              from={DJConsoleRoute.fullPath}
              to={CollectionRoute.fullPath}
              params={{ collectionId: id } as any}
            />
        ))}
      </NavLink>
    </OverlayScrollbarsComponent>
  )
}

const Layout = () => {
  const params = useParams({ strict: false });

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 200,
        breakpoint: 20,
        collapsed: {
          mobile: false,
          desktop: false
        },
      }}
    >
      <AppShell.Header>
        Nav
      </AppShell.Header>

      <AppShell.Navbar p="sm" style={{ overflow: 'hidden', textWrap: 'wrap', wordBreak: 'break-word' }}>
        <Sidebar />
      </AppShell.Navbar>

      <AppShell.Main>
        <Box style={{ position: 'sticky', top: 60, height: 200, zIndex: 100 }} >
          <TopBar stationId={params.station || ''} />
        </Box>

        <Outlet />
      </AppShell.Main>

    </AppShell>
  )
}

export const Route = createFileRoute('/dj/_dj-layout')({
  component: Layout
});

