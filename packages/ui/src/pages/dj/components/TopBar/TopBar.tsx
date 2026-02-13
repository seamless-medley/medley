import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ActionIcon, Badge, Box, Button, Flex, Group, Image, rem, Text, Tooltip } from "@mantine/core";
import { IconPlayerPause, IconPlayerPlay, IconPlayerTrackNext } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useContextMenu } from "mantine-contextmenu";
import clsx from "clsx";
import { AutoScroller } from "@ui/components/AutoScroller";
import { PlayHeadText } from "@ui/components/PlayHeadText";
import { TransitionText } from "@ui/components/TransitionText";
import { LyricsBar } from "@ui/components/LyricsBar";
import { useRemotableProp } from "@ui/hooks/remotable";
import { usePlayingStationId } from "@ui/hooks/useClient";
import { useDeckCover, useDeckInfo } from "@ui/hooks/useDeck";
import { useStation } from "@ui/hooks/useStation";
import { Panel } from "@ui/pages/components/Panel";
import { DJConsoleRoute } from "@ui/pages/dj/DJConsolePage/route";
import { CollectionRoute } from "@ui/pages/dj/CollectionPage/route";
import { client } from "@ui/init";
import fallbackImage from '@ui/fallback-image.svg?inline';
import classes from './TopBar.module.css';
import type { CrateSource, SequenceChances, SequenceLimit, TrackCollection } from "@seamless-medley/remote";
import { theme } from "@ui/theme";
import { noop } from "lodash";

type StationIdProps = {
  stationId: string;
}

export const TopBarContext = createContext<StationIdProps>(null!);

const StationPanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');
  const description = useRemotableProp(station, 'description');
  const audienceCount = useRemotableProp(station, 'audienceCount', 0);
  const playingStationId = usePlayingStationId();

  const toggleListen = useCallback(() => {
    if (!station) {
      return;
    }

    if (playingStationId === stationId) {
      client.stopAudio();
    } else {
      client.playAudio(stationId);
    }
  }, [station, stationId, playingStationId]);

  const isListening = (playingStationId !== undefined) && (playingStationId === stationId);

  return (
    <Panel className={classes.station} w={240} header="STATION">
      <Flex className={classes.info}>
        <Flex className={classes.infoLine} p={2}>
          <AutoScroller>
            <Text size='1rem'>{name}</Text>
          </AutoScroller>
        </Flex>

        <Flex className={classes.infoLine}>
          <AutoScroller>
            <Text c='dark.3' size='0.8em' h='1.2em'>{description}</Text>
          </AutoScroller>
        </Flex>
      </Flex>

      <Flex className={classes.listeners}>
        <Text size='0.8rem'>{audienceCount} Listeners</Text>

        <Tooltip withArrow label={!isListening ? 'Listen' : 'Stop Listening'} position="bottom">
          <Button size="xs" variant="outline" onClick={toggleListen}>
            {isListening
              ? 'Listening'
              : 'Listen'
            }
          </Button>
        </Tooltip>
      </Flex>
    </Panel>
  )
}

const Cover: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const info = useDeckInfo(stationId, activeDeck, 'trackPlay');
  const { cover } = useDeckCover(stationId, activeDeck);

  return (
    <Box component={motion.div}
      style={{ aspectRatio: 1 }}
      h='100%'
    >
      <AnimatePresence mode="wait">
        <Image component={motion.img}
          key={`${info.trackPlay?.uuid}`}
          src={cover}
          h="100%"
          fit="cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          fallbackSrc={fallbackImage}
        />
      </AnimatePresence>
    </Box>
  )
}

const TransportControl: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const playState = useRemotableProp(station, 'playState');

  const play = useCallback(() => {
    if (!station) {
      return;
    }

    station.start();
    client.playAudio(stationId);
  }, [station, stationId]);

  const iconSize = rem(32);
  const iconStroke = 1.2;

  return (
    <ActionIcon.Group style={{ group: { borderRadius: 0 } }} bg='dark.8'>
      <ActionIcon
        aria-label="Play"
        disabled={playState === 'playing'}
        size={iconSize}
        color='dark.8'
        onClick={play}
        radius={0}
      >
        <IconPlayerPlay stroke={iconStroke} size={14} />
      </ActionIcon>

      <ActionIcon
        aria-label="Pause"
        disabled={playState === 'paused'}
        size={iconSize}
        color="dark.8"
        onClick={() => station?.pause()}
        radius={0}
      >
        <IconPlayerPause stroke={iconStroke} size={14}  />
      </ActionIcon>

      <Tooltip withArrow autoContrast label="Skip to next track" position="right">
        <ActionIcon
          aria-label="Skip"
          size={iconSize}
          color="dark.8"
          onClick={() => station?.skip()}
          radius={0}
        >
          <IconPlayerTrackNext stroke={iconStroke} size={14}  />
        </ActionIcon>
      </Tooltip>
    </ActionIcon.Group>
  )
}

const TrackPanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const title = trackPlay?.track?.extra?.tags?.title;
  const artist = trackPlay?.track?.extra?.tags?.artist;

  return (
    <Panel className={classes.playback} direction={'row'} header="PLAYING">
      <Cover />
      <Flex className={classes.track}>
        <Flex direction='column' px={4}>
          <TransitionText
            py={5}
            fw={600}
            size='1rem'
            h='1.3rem'
            transition={{ delay: 0.4 }}
            autoscroll
          >
            {title ?? trackPlay?.track?.path}
          </TransitionText>

          <TransitionText
            py={5}
            size="0.8rem"
            h='2rem'
            transition={{ delay: 0.5 }}
            autoscroll
          >
            {artist}
          </TransitionText>

          {trackPlay?.track?.collection?.id
            ? <Link
              from={DJConsoleRoute.fullPath}
              to={CollectionRoute.fullPath}
              params={{ collectionId: trackPlay.track.collection.id }}>
              <Text size="0.7em" h="1.6em" style={{ textWrap: 'nowrap' }}>{trackPlay.track.collection.description}</Text>
            </Link>
            : <Text size="0.7em" h="1.6em"></Text>
          }

          {trackPlay?.track?.sequencing &&
            <Text size="0.7em" h="1.6em" style={{ textWrap: 'nowrap' }}>
              Sequence: {trackPlay.track.sequencing.playOrder.join('/')}
              {trackPlay?.track?.sequencing?.latch &&
                <span> (Latching {trackPlay.track.sequencing.latch.order.join('/')})</span>
              }
            </Text>
          }
        </Flex>

        <Flex justify='space-between' align="center" style={{ borderTop: '1px solid var(--mantine-color-dark-8)'}}>
          <TransportControl />
          <Group justify="end" p={4}>
            <PlayHeadText
              stationId={stationId}
              deckIndex={activeDeck}
              c="indigo.3"
              size="0.85rem"
            />
          </Group>
        </Flex>
      </Flex>
    </Panel>
  )
}

type ProfileContextValue = {
  selectedProfileId: string | undefined;
  setSelectedProfileId: (newValue: string) => any;
}

const ProfilePanelContext = createContext<ProfileContextValue>(null!);

const ProfilePanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const currentProfileId = useRemotableProp(station, 'currentProfile');
  const profiles = useRemotableProp(station, 'profiles');
  const { selectedProfileId, setSelectedProfileId } = useContext(ProfilePanelContext);

  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const storeItemRef = useCallback((id: string) => (el: HTMLElement | null) => {
    itemRefs.current[id] = el;
  }, [])

  const { showContextMenu } = useContextMenu();

  const setSelection = useCallback((id: string) => {
    setSelectedProfileId(id);
    itemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const changeProfile = useCallback((id: string) => {
    if (station?.changeProfile?.(id)) {
      setSelection(id);
    }
  }, [station]);

  useEffect(() => {
    if (currentProfileId && !selectedProfileId) {
      setSelection(currentProfileId);
    }
  }, [currentProfileId]);

  return (
    <Panel w={240} header='PROFILES'>
      <OverlayScrollbarsComponent>
        <Flex className={classes.listPanel}>
          {profiles?.map((p) => (
            <Flex
              key={p.id}
              className={clsx(classes.item, selectedProfileId === p.id && classes.selected)}
              ref={storeItemRef(p.id)}
              onClick={() => setSelection(p.id)}
              onContextMenu={showContextMenu(
                [
                  {
                    key: 'switch',
                    title: <>Switch to <span style={{ color: theme.colors.blue[5] }}>{p.name}</span> profile</>,
                    disabled: (station === undefined) || (p.id === currentProfileId),
                    onClick: () => changeProfile(p.id)
                  }
                ]
              )}
            >
              <Flex className={classes.primary}>
                <Group>{p.name}</Group>
                <Group className={classes.secondary}>{p.description}</Group>
              </Flex>
              <Group mr={10}>
                {p.id === currentProfileId && <Badge size='xs' autoContrast>Current</Badge>}
              </Group>
            </Flex>
          ))}
        </Flex>
      </OverlayScrollbarsComponent>
    </Panel>
  )
}

const CratePanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const [collections, setCollections] = useState<TrackCollection[]>([]);
  const profiles = useRemotableProp(station, 'profiles');
  const currentProfileId = useRemotableProp(station, 'currentProfile');
  const { selectedProfileId } = useContext(ProfilePanelContext);
  const crates = profiles?.find(p => p.id === selectedProfileId)?.crates ?? [];
  const currentCrate = useRemotableProp(station, 'currentCrate');
  const currentCollection = useRemotableProp(station, 'currentCollection');
  const activeDeck = useRemotableProp(station, 'activeDeck');
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const storeItemRef = useCallback((id: string) => (el: HTMLElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  useEffect(() => {
    station?.getCollections().then(setCollections);
  }, [station]);

  useEffect(() => {
    if (currentCrate) {
      itemRefs.current[currentCrate]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedProfileId, currentCrate]);

  const changeSequence = useCallback((createId: string, collectionId: string) => {
    station?.changePlaySequence(createId, collectionId);
  }, [station]);

  const { showContextMenu } = useContextMenu();

  const formatSource = useCallback((source: CrateSource, showWeight: boolean) => {
    const col = collections.find(col => col.id === source.id);
    if (!col) return '';

    return (
      <>
        <span>{col.description}</span>
        {showWeight && <span className={classes.sourceWeight}>({source.weight})</span>}
      </>
    )
  }, [collections]);

  const formatChance = useCallback((chances: SequenceChances) => {
    if (chances === 'random') {
      return <span className={classes.sequenceChances}>Randomly</span>
    }

    if (chances.yes === Infinity) {
      return <span className={classes.sequenceChances}>Always</span>
    }

    const total = chances.yes + chances.no;

    return (
      <>
        <span className={classes.sequenceChances}>{chances.yes}</span>
        /
        <span className={classes.sequenceChances}>{total}</span>
      </>
    );
  }, []);

  const formatLimit = useCallback((limit: SequenceLimit) => {
    if (limit === 'entirely') {
      return <span className={classes.sequenceLimit}>All tracks</span>;
    }

    if (typeof limit === 'number') {
      return (
        <>
          <span className={classes.sequenceLimit}>{limit}</span> track(s)
        </>
      );
    }

    switch (limit.by) {
      case 'sample':
      case 'one-of':
        return (
          <>
            One of [<span className={classes.sequenceLimit}>{limit.list.join(', ')}</span>] track(s)
          </>
        )

      case 'range':
        return (
          <>
            <span className={classes.sequenceLimit}>{limit.range.min}</span>
            to
            <span className={classes.sequenceLimit}>{limit.range.max}</span>
            track(s)
          </>
        )

      case 'upto':
        return (
          <>
            Up to
            <span className={classes.sequenceLimit}>{limit.upto}</span>
            track(s)
          </>
        )
    }
  }, []);

  const isLatching = trackPlay?.track.sequencing?.latch !== undefined;

  return (
    <Panel w={240} header='SEQUENCES'>
      <OverlayScrollbarsComponent>
        <Flex className={classes.listPanel}>
          {collections.length && crates.map((crate) => (
            <Flex
              key={crate.id}
              className={classes.item}
              ref={storeItemRef(crate.id)}
              onContextMenu={showContextMenu([
                ...(isLatching
                  ? [
                    { key: 'latching', title: 'Latching is active', disabled: true, onClick: () => noop },
                  ]
                  : (currentProfileId !== selectedProfileId)
                    ? [
                      { key: 'profile_inactive', title: 'Profile is not active', disabled: true, onClick: () => noop },
                    ]
                    : []
                ),
                ...(!isLatching && (currentProfileId === selectedProfileId))
                ? crate.sources
                  .map(s => collections.find(col => col.id === s.id)!)
                  .map(col => ({
                    key: col.id,
                    title: <>Play from <span style={{ color: theme.colors.blue[5] }}>{col.description}</span></>,
                    disabled: (col.id === currentCollection),
                    onClick: () => changeSequence(crate.id, col.id)
                  }))
                : []
              ])}
            >
              <Flex className={classes.primary}>
                {crate.sources.map(s =>
                  <Group key={`${crate.id}:${s.id}`} gap={0}>
                    <Link
                      style={{ color: 'white' }}
                      from={DJConsoleRoute.fullPath}
                      to={CollectionRoute.fullPath}
                      params={{ collectionId: s.id }}
                    >
                      {formatSource(s, crate.sources.length > 1)}
                    </Link>
                  </Group>
                )}
                <Group className={classes.secondary} gap={2}>
                  Chances: {formatChance(crate.chances)}
                </Group>
                <Group className={classes.secondary} gap={0}>{formatLimit(crate.limit)}</Group>
              </Flex>
              <Group mr={10}>
                {crate.id === currentCrate && <Badge size='xs' autoContrast>Current</Badge>}
              </Group>
            </Flex>
          ))}
        </Flex>
      </OverlayScrollbarsComponent>
    </Panel>
  );
}

const ProfileAndCrate: React.FC = () => {
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);

  const profileContext: ProfileContextValue = {
    selectedProfileId,
    setSelectedProfileId
  }

  return (
    <ProfilePanelContext value={profileContext}>
      <ProfilePanel />
      <CratePanel />
    </ProfilePanelContext>
  );
}

export const TopBar: React.FC<StationIdProps> = React.memo((props) => {
  return (
    <TopBarContext.Provider value={props}>
      <Flex className={classes.topbar}>
        <Flex className={classes.main}>
          <StationPanel />
          <TrackPanel />
          <ProfileAndCrate />
          <Box className={classes.fill} />
        </Flex>
        <Panel className={clsx(classes.lyricsBar)} header="LYRICS">
          <LyricsBar stationId={props.stationId} size="lg" autoscroll />
        </Panel>
      </Flex>
    </TopBarContext.Provider>
  )
});
