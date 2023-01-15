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
import { Collection } from '../socket/remote';

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

  console.log('collection', collection);

  useEffect(() => {
    if (!station) {
      return;
    }

    station.getCollections().then(setCollections);

    // station.getCollections().then(async cols => {
    //   console.log('Got collections');

    //   for (const col of cols) {
    //     const s = await client.surrogateOf(StubCollection, 'collection', col);

    //     console.log('Options', s.options());
    //     console.log('ID', s.id());

    //     const getAll = async () => console.log('All tracks for', col, await s.all());

    //     s.on('refresh', () => {
    //       getAll();
    //     })

    //     s.on('trackShift', (track) => {
    //       console.log('Track shift from', col, track);
    //     });

    //     s.on('trackPush', (track) => {
    //       console.log('Track push to', col, track);
    //     });
    //   }
    // });
  }, [station]);

  const shuffle = useCallback(() => {
    if (selectedCollection) {
      client.remoteInvoke('collection', selectedCollection, 5000, 'shuffle')
    }
  }, [selectedCollection])

  return (
    <>
      {station ?
        <>
          <div>
            Left: <VUMeter stationId={'demo'} channel="left" />
          </div>
          <div>
            Right: <VUMeter stationId={'demo'} channel="right" />
          </div>
        </>
        :
        undefined
      }
      <br />
      <Group>
        <Button disabled={!station} onClick={() => station?.start()}>Start</Button>
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
