import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Center, Flex, px } from "@mantine/core";
import { PlayDeck, PlayDeckProps, PlayHead } from "@ui/pages/dj/components/PlayDeck";
import { useParams } from "@tanstack/react-router";
import { ResizablePanel } from "@ui/components/ResizablePanel";
import { Panel } from "@ui/pages/components/Panel";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useDeckInfo } from "@ui/hooks/useDeck";
import classes from './DJConsolePage.module.css';
import { useStation } from "@ui/hooks/useStation";
import { Remotable, RequestCollectionView, RequestTrackRecord } from "@seamless-medley/remote";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useCollectionList } from "@ui/pages/hooks/useCollectionList";

const DeckPanel: React.FC<PlayDeckProps> = ({ ...props }) => {
  const info = useDeckInfo(props.stationId, props.index, 'active', 'trackPlay');

  const state = info.active
    ? 'active'
    : info?.trackPlay?.uuid !== undefined
      ? 'loaded'
      : 'idle'

  const headerClass = {
    active: classes.activeDeck,
    loaded: classes.loadedDeck,
    idle: undefined
  }[state];

  const controlCompoennt = useMemo(
    () => <PlayHead stationId={props.stationId} index={props.index} />,
    [props.stationId, props.index]
  );

  return (
    <Panel
      h={150}
      mih={150}
      borders={{ bottom: true }}
      header={{
        caption: `Deck ${props.index + 1}`,
        className: headerClass,
      }}
    >
      <PlayDeck
        {...props}
        controlComponent={controlCompoennt}
      />
    </Panel>
  )
}

const Decks = () => {
  const { station: stationId } = useParams({ strict: false });

  return (
    <OverlayScrollbarsComponent>
      <Flex className={classes.decks}>
        {[0, 1, 2].map((_, index) => (
          <DeckPanel
            key={index}
            stationId={stationId}
            index={index}
          />
        ))}
      </Flex>
    </OverlayScrollbarsComponent>
  )
}

const RequestedTracks = () => {
  const { station: stationId } = useParams({ strict: false });

  const { station } = useStation(stationId);

  const [view, setView] = useState<Remotable<RequestCollectionView>>();

  const count = useRemotableProp(station, 'requestsCount') ?? 0;

const getItemData = useCallback(([id, artist, title]: RequestTrackRecord) => ({ id, artist, title }), []);

  const { ref, virtualizer, virtualItems, items } = useCollectionList(view, {
    count,
    estimateSize: () => +px('2.25em'),
    overscan: 20,
    getItemData
  });

  useEffect(() => {
    if (!station) {
      return;
    }

    let currentView: Remotable<RequestCollectionView> | undefined;

    station.createRequestView(0).then(v => {
      currentView = v;
      setView(v);
    });

    return () => {
      currentView?.dispose();
    };
  }, [station]);

  return (
    <div ref={ref} style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualItems.map(vrow => {
          const item = items[vrow.index];
          return (
            <div
              key={vrow.key}
              style={{ position: 'absolute', top: vrow.start, height: vrow.size, width: '100%' }}
            >
              {item ? `${item.artist ?? ''} - ${item.title ?? ''}` : 'Loading...'}
            </div>
          );
        })}
      </div>
    </div>
  )
}

export const DJConsolePage = () => {
  return (
    <Flex component="section" className={classes.djConsole}>
      <ResizablePanel.Group orientation='horizontal'>
        <ResizablePanel minSize={400} flexSize={0.6} style={{ 'flexDirection': 'column'}}>
          <Decks />
          <Panel header='Requests' h='calc(100% - 450px - 2px)' innerHeight='100%'>
            <RequestedTracks />
          </Panel>
        </ResizablePanel>

        <ResizablePanel.Resizer />

        <ResizablePanel minSize={250} flexSize={0.8}>
          <Panel header='History' h={'100%'} orientation='vertical' borders={{ right: true }}>
            <Center h='100%' c='gray.8'>Not yet implemented</Center>
          </Panel>
        </ResizablePanel>

        <ResizablePanel.Resizer />

        <ResizablePanel minSize={250} flexSize={0.8}>
          <Panel header='Latches' h={'100%'} orientation='vertical' borders={{ right: true }}>
            <Center h='100%' c='gray.8'>Not yet implemented</Center>
          </Panel>
        </ResizablePanel>

        <ResizablePanel.Resizer />

        <ResizablePanel minSize={250} flexSize={0.8}>
          <Panel header='Listeners' h={'100%'} orientation='vertical' borders={{ right: true }}>
            <Center h='100%' c='gray.8'>Not yet implemented</Center>
          </Panel>
        </ResizablePanel>

      </ResizablePanel.Group>
    </Flex>
  )
}
