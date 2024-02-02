import React, { useCallback, useEffect, useState } from 'react';

import { AspectRatio, Box, Button, Center, Grid, Group, Stack } from '@mantine/core';
import { useParams } from '@tanstack/react-router';

import { useClient } from '../../hooks/useClient';
import { useStation } from '../../hooks/useStation';
import { useRemotableProps } from '../../hooks/remotable';
import { VUMeter } from '../../components/VUMeter';
import { useCollection } from '../../hooks/useCollection';
import type { Track } from '../../../remotes/core/po/track';
import type { Station } from '../../../remotes/core/station';
import { PlayDeck } from '../../components';
import { route } from './route';
import { times } from 'lodash';
import { useDeckInfo } from '../../hooks/useDeck';

const PlayHead: React.FC<{ stationId: string }> = ({ stationId }) => {
  const { station } = useStation(stationId);

  const activeDeck = station?.activeDeck() ?? 0;

  const { info, cover } = useDeckInfo(stationId, station?.activeDeck() ?? 0);

  return (
    <>
      <h4>Deck: {activeDeck !== undefined ? activeDeck + 1 : 'None'}</h4>
      <h4>Position: {info.cp.toFixed(2)}</h4>
      <AspectRatio ratio={1} style={{ width: 250 }}>
        <img src={cover}  />
      </AspectRatio>
    </>
  )
}

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
  const params = useParams({ from: route.id });
  const stationId = params.station;

  const client = useClient();
  const { station, error: stationError } = useStation(stationId);
  const stationProps = useRemotableProps(station);

  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>();
  const { collection } = useCollection(selectedCollection);

  const handleCollectionChange: Station['ϟcollectionChange'] = (oldId, newId) => {
    setSelectedCollection(newId);
  }

  useEffect(() => {
    if (!station) {
      return;
    }

    station.getCollections().then(setCollections);
    station.getCurrentCollection().then(setSelectedCollection);

    station.on('collectionChange', handleCollectionChange);

    return () => {
      station.off('collectionChange', handleCollectionChange);
    }
  }, [station]);

  const shuffle = useCallback(() => {
    if (selectedCollection) {
      client.remoteInvoke('collection', selectedCollection, 5000, 'shuffle')
    }
  }, [selectedCollection]);

  if (stationError) {
    return <h1>No Such Station {params.station} {JSON.stringify(stationError)}</h1>
  }

  return (
    <>
      <h1>{stationId}</h1>
      <div>
        Left: <VUMeter channel="left" />
      </div>
      <div>
        Right: <VUMeter channel="right" />
      </div>

      <br />
      <Group>
        <Button disabled={!station} onClick={() => {
          if (station) {
            station.start();
            client.playAudio(stationId);
          }
        }}>
          Start
        </Button>
        <Button disabled={!station} onClick={() => station?.pause()}>Pause</Button>
        <Button disabled={!station} onClick={() => station?.skip()?.then(r => console.log('Skip', r)) } color="red">Skip</Button>
        <Button onClick={shuffle}>Shuffle {collection?.description()} collection</Button>
      </Group>
      <h4>Play State: { stationProps?.playState }</h4>


      <PlayHead stationId={stationId} />

      {/* <Grid>

        {times(3).map(index => (

        <Grid.Col span={4} key={index} sx={{ height: 950, border: '1px solid red' }}>
          <Center sx={{ display: 'block' }}>
            <h2>Deck{index+1}</h2>
            <PlayDeck {...{ station, index }}/>
          </Center>
        </Grid.Col>
        ))}
      </Grid> */}

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
        <Grid.Col span='auto'>
          <Box style={{ border: '1px solid red', height: '100%' }}>
          </Box>
        </Grid.Col>
      </Grid>

      {/* {collections.map(c => <h4 key={c} onClick={() => setSelectedCollection(c)}>{c}</h4>)}
      <h2>{selectedCollection}</h2>
      {selectedCollection ? <CollectionList id={selectedCollection} /> : undefined} */}
    </>
  );
}

export default DJ;
