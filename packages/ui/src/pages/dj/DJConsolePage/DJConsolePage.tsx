import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Center, Flex, Group, px, Tooltip } from "@mantine/core";
import { PlayDeck, PlayDeckProps, PlayHead } from "@ui/pages/dj/components/PlayDeck";
import { useParams } from "@tanstack/react-router";
import { ResizablePanel } from "@ui/components/ResizablePanel";
import { Panel } from "@ui/pages/components/Panel";
import { CORSImage } from "@ui/components/CORSImage";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useDeckInfo } from "@ui/hooks/useDeck";
import classes from './DJConsolePage.module.css';
import { useStation } from "@ui/hooks/useStation";
import { Remotable, RequestCollectionView, Requester, RequestTrackRecord, Track } from "@seamless-medley/remote";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useCollectionList } from "@ui/pages/hooks/useCollectionList";
import { AutoScroller } from "@ui/components/AutoScroller";

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

const RequesterInfo: React.FC<{ requester: Requester }>  = ({ requester }) => {
  return (
    <Group className={classes.avatarBox}>
      {requester.type === 'discord' && requester.data !== undefined
        ? <Tooltip label={`Discord user ${requester.data.displayName} via ${requester.data.guild.name}`} style={{ fontSize: '0.7em'}}>
          {requester.data?.avatar
            ? <CORSImage className={classes.avatar} src={requester.data.avatar} />
            : <div className={classes.dummyAvatar} />
          }
          </Tooltip>
        :
          <Tooltip label={`${requester.requesterId} via ${requester.type} (${requester.group})`}>
            <div className={classes.dummyAvatar} />
          </Tooltip>
      }
    </Group>
  )
}

const RequestedTracks = () => {
  const { station: stationId } = useParams({ strict: false });

  const { station } = useStation(stationId);

  const [view, setView] = useState<Remotable<RequestCollectionView>>();

  const count = useRemotableProp(station, 'requestsCount') ?? 0;

  const getItemData = useCallback(([id, artist, title, requesters]: RequestTrackRecord) => ({ id, artist, title, requesters }), []);

  const { ref, virtualItems, items } = useCollectionList(view, {
    count,
    estimateSize: () => +px('2.25em'),
    overscan: 10,
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
    <Flex ref={ref} className={classes.requestsList}>
      <Panel.List header='Requests' innerHeight='100%' w='100%'>
        {virtualItems.map(vrow => {
          const item = items[vrow.index];

          const children = item
            ? (
              <Flex className={classes.item}>
                <AutoScroller stableId={item.id}>
                  {item.artist} - {item.title}
                </AutoScroller>

                <AutoScroller stableId={`avatar-${item.id}`}>
                  <Group gap={2} className={classes.requestedBy}>
                    Requested by
                    <Group gap={4} wrap="nowrap">
                      {item.requesters.map(r => <RequesterInfo requester={r} />)}
                    </Group>
                  </Group>
                </AutoScroller>
              </Flex>

            )
            : (
              <>
                Loading...
              </>
            )

          return (
            <Flex key={vrow.key} className={classes.itemContainer}>
              {children}
            </Flex>
          );
        })}
      </Panel.List>
    </Flex>
  );
}

export const DJConsolePage = () => {
  return (
    <Flex component="section" className={classes.djConsole}>
      <ResizablePanel.Group orientation='horizontal'>
        <ResizablePanel minSize={400} flexSize={0.6}>
          <Decks />
          <RequestedTracks />
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
