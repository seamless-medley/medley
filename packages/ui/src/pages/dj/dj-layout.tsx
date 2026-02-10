import { useEffect, useState } from 'react';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { Box, NavLink } from '@mantine/core'
import { createFileRoute, Link, Outlet, useMatchRoute, useParams } from '@tanstack/react-router'
import { TrackCollection } from '@seamless-medley/remote';
import { ResizablePanel } from '@ui/components/ResizablePanel';
import { useStation } from '@ui/hooks/useStation';
import { useRemotableProp } from '@ui/hooks/remotable';
import { DJConsoleRoute } from './DJConsolePage/route';
import { CollectionRoute } from './CollectionPage/route';
import classes from './dj-layout.module.css';
import { TopBar } from './components/TopBar';

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
              noWrap
            />
        ))}
      </NavLink>
    </OverlayScrollbarsComponent>
  )
}

const Layout = () => {
  const params = useParams({ strict: false });

  return (
    <ResizablePanel.Group orientation='horizontal'>
      <ResizablePanel
        className={classes.leftPanel}
        minSize={200}
        maxSize={400}
        flexSize={0.1}
      >
        <Sidebar />
      </ResizablePanel>

      <ResizablePanel.Resizer />

      <ResizablePanel
        className={classes.rightPanel}
        minSize={200}
        flexSize={0.9}
      >
          <Box style={{ position: 'sticky', top: 'var(--navbar-height)', height: 200, zIndex: 10 }} >
            <TopBar stationId={params.station || ''} />
          </Box>

          <Outlet />
      </ResizablePanel>
    </ResizablePanel.Group>
  );
}

export const Route = createFileRoute('/_layout/dj/_dj-layout')({
  component: Layout
});

