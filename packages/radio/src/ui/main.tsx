import React, { useCallback, useEffect, useState } from 'react';

import { initRoot } from './init';
import { Button, Group, MantineProvider } from '@mantine/core';
import { useClient } from './hooks/useClient';
import { useStation } from './hooks/useStation';
import { useRemotableProps } from './hooks/remotable';
import { StubCollection } from './stubs/collection';
import { VUMeter } from './components/vu-meter';
import { useCollection } from './hooks/useCollection';
import { Track } from '../socket/po/track';
import { PickMethod } from '../socket/types';
import { Collection, Station } from '../socket/remote';

const CollectionList: React.FC<{ id: string }> = ({ id }) => {
  const collection = useCollection(id);
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

const App: React.FC = () => {
  const client = useClient();
  const station = useStation('demo');
  const stationProps = useRemotableProps(station);

  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>();
  const collection = useCollection(selectedCollection);

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

  return (
    <>
      <div>
        Left: <VUMeter stationId={'demo'} channel="left" />
      </div>
      <div>
        Right: <VUMeter stationId={'demo'} channel="right" />
      </div>

      <br />
      <Group>
        <Button disabled={!station} onClick={() => {
          if (station) {
            station.start();
            client.playAudio(station.id());
          }
        }}>
          Start
        </Button>
        <Button disabled={!station} onClick={() => station?.pause()}>Pause</Button>
        <Button disabled={!station} onClick={() => console.log('Skip', station?.skip())} color="red">Skip</Button>
        <Button onClick={shuffle}>Shuffle {collection?.description()} collection</Button>
      </Group>
      <h4>Play State: { stationProps?.playState }</h4>

      {/* <h2>Deck1</h2>
      <Deck station={station} index={0} />

      <h2>Deck2</h2>
      <Deck station={station} index={1} />

      <h2>Deck3</h2>
      <Deck station={station} index={2} /> */}

      {collections.map(c => <h4 key={c} onClick={() => setSelectedCollection(c)}>{c}</h4>)}
      <h2>{selectedCollection}</h2>
      {selectedCollection ? <CollectionList id={selectedCollection} /> : undefined}
    </>
  );
}

initRoot().render(
  // <React.StrictMode>
    <MantineProvider withGlobalStyles withNormalizeCSS withCSSVariables>
      <App />
    </MantineProvider>
  // </React.StrictMode>
);
