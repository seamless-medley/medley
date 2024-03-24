import React, { useEffect, useState } from 'react';

import { Box, Center, Grid, Stack } from '@mantine/core';

import { useStation } from '../../hooks/useStation';
import { useCollection } from '../../hooks/useCollection';
import type { Track } from '../../../remotes/core/po/track';
import type { Station } from '../../../remotes/core/station';
import { PlayDeck } from '../../components';
import { stationRoute } from './route';
import { times } from 'lodash';
import { TopBar } from './top';


const CollectionList: React.FC<{ id: string }> = ({ id }) => {
  const { collection } = useCollection(id);
  const [items, setItems] = useState<Track[]>([]);

  const refresh = () => {
    collection?.all().then(setItems);
  }

  const handleShift = (track: Track) => {
    setItems(([, ...rest]) => rest);
  }

  const handlePush = (track: Track) => {
    setItems(prev => [...prev, track]);
  }

  useEffect(() => {
    if (!collection) {
      return;
    }

    refresh();

    collection.on('refresh', refresh);
    collection.on('trackShift', handleShift);
    collection.on('trackPush', handlePush);
    // TODO: Handle other events

    return () => {
      collection.off('refresh', refresh);
      collection.off('trackShift', handleShift);
      collection.off('trackPush', handlePush);
    }
  }, [collection]);

  return (
    <>
      {items.map((item, index) => <div key={item.id}>{item.path}</div>)}
    </>
  )
}

export const DJ: React.FC = () => {
  console.log('DJ');
  const params = stationRoute.useParams();
  const stationId = params.station;

  const { station, error: stationError } = useStation(stationId);

  // const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>();
  // const { collection } = useCollection(selectedCollection);

  const handleCollectionChange: Station['ϟcollectionChange'] = (oldId, newId) => {
    setSelectedCollection(newId);
  }

  useEffect(() => {
    if (!station) {
      return;
    }

    // station.getCollections().then(setCollections);
    station.getCurrentCollection().then(setSelectedCollection);

    station.on('collectionChange', handleCollectionChange);

    return () => {
      station.off('collectionChange', handleCollectionChange);
    }
  }, [station]);

  // const shuffle = useCallback(() => {
  //   if (selectedCollection) {
  //     client.remoteInvoke('collection', selectedCollection, 5000, 'shuffle')
  //   }
  // }, [selectedCollection]);

  if (stationError) {
    return <h1>No Such Station {params.station} {JSON.stringify(stationError)}</h1>
  }


  return (

    <div>
      <Box style={{ position: 'sticky', top: 60, height: 200, zIndex: 100 }} >
        <TopBar stationId={stationId} />
      </Box>

      <Grid>
        <Grid.Col span={4}>
          <Stack>
            {times(3).map(index => (
              <Center key={index} style={{ display: 'block' }}>
                { <PlayDeck {...{ stationId, index }}/> }
              </Center>
            ))}
          </Stack>
        </Grid.Col>
      </Grid>

      {/* {collections.map(c => <h4 key={c} onClick={() => setSelectedCollection(c)}>{c}</h4>)}
      <h2>{selectedCollection}</h2>
      {selectedCollection ? <CollectionList id={selectedCollection} /> : undefined} */}
    </div>
  );
}

export default DJ;
