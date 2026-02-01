import { useEffect, useState } from 'react';
import { Box, Flex, NavLink, Stack } from '@mantine/core'
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

  const [isShowingCollections, setShowingCollections] = useState(atCollection);

  useEffect(() => {
    atCollection && setShowingCollections(true)
  }, [atCollection]);

  return (
    <OverlayScrollbarsComponent>
      <NavLink
        activeOptions={{ exact: true }}
        component={Link}
        from={DJConsoleRoute.fullPath}
        to={DJConsoleRoute.to}
        label="Station"
      />

      <NavLink label="Collections" opened={isShowingCollections} onClick={() => setShowingCollections(prev => !prev)}>
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
    <Flex>
      <Box style={{ position: 'sticky', height: 'calc(100cqh - var(--navbar-height))', top: 80, width: 300, zIndex: 10 }}>
        <Sidebar />
      </Box>
      <Stack w='100%'>
        <Box style={{ position: 'sticky', top: 80, height: 200, zIndex: 10 }} >
          <TopBar stationId={params.station || ''} />
        </Box>
        <Outlet />
      </Stack>
    </Flex>
  );
}

export const Route = createFileRoute('/_layout/dj/_dj-layout')({
  component: Layout
});

