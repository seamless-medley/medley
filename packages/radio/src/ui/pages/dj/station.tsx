import React, { useCallback, useEffect, useState } from 'react';

import { AppShell, Box, NavLink } from '@mantine/core';
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

import { useStation } from '../../hooks/useStation';
import type { Station as RemoteStation } from '../../../remotes/core/station';
import { collectionRoute, stationIndexRoute, stationRoute } from './route';
import { TopBar } from './top';
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router';
import { client } from '../../init';

type CollectionInfo = {
  id: string;
  description: string;
}

export const Station: React.FC = () => {
  const matchRoute = useMatchRoute()

  const stationId = stationRoute.useParams({ select: ({ station }) => station });
  const collectionId = collectionRoute.useParams({ select: ({ collectionId }) => collectionId });

  const { station, error: stationError } = useStation(stationId);

  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [currentCollection, setCurrentCollection] = useState('');

  const updateCurrentCollection = (fullId: string) => setCurrentCollection(fullId.split('/', 2)[1]);

  const handleCollectionChange = useCallback<RemoteStation['ϟcollectionChange']>((oldId, newId) => {
    updateCurrentCollection(newId);
  }, []);

  useEffect(() => {
    if (!station) {
      return;
    }

    station.getCollections().then(all => {
      setCollections(all);
      console.log(all);
    });
    station.getCurrentCollection().then(id => id ? updateCurrentCollection(id) : undefined);
    station.on('collectionChange', handleCollectionChange);

    return () => {
      station.off('collectionChange', handleCollectionChange);
    }
  }, [station]);

  if (stationError) {
    return <div>Error loading station</div>
  }

  return (
    <>
      <AppShell.Navbar p="sm" style={{ overflow: 'hidden', textWrap: 'wrap', wordBreak: 'break-word' }}>
        <OverlayScrollbarsComponent>
          <NavLink
            active={matchRoute({ to: stationIndexRoute.to as any }) !== false}
            component={Link}
            to={stationIndexRoute.to}
            label="Station"
          />

          <NavLink label="Collections" defaultOpened={matchRoute({ to: collectionRoute.to as any }) !== false}>
            {collections.map(({ id, description }) => (
              <NavLink
                key={id}
                component={Link}
                label={description}
                c={currentCollection === id ? 'green.5' : undefined}
                fw={currentCollection === id ? 'bold' : undefined}
                style={{ transition: 'all 1s ease' }}
                active={collectionId === id}
                to={collectionRoute.to}
                params={{ collectionId: id }}
              />
            ))}
          </NavLink>
        </OverlayScrollbarsComponent>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box style={{ position: 'sticky', top: 60, height: 200, zIndex: 100 }} >
          <TopBar stationId={stationId} />
        </Box>

        <Outlet />
      </AppShell.Main>
    </>
  );
}

export default Station;
