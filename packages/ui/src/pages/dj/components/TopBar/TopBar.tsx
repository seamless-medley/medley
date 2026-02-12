import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ActionIcon, Badge, Box, Button, Flex, Group, Image, rem, Text, Tooltip } from "@mantine/core";
import { IconPlayerPause, IconPlayerPlay, IconPlayerTrackNext } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
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
import { useContextMenu } from "mantine-contextmenu";

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
            h='1.8rem'
            transition={{ delay: 0.4 }}
            nowrap
            autoscroll
          >
            {title}
          </TransitionText>

          <TransitionText
            py={5}
            size="0.8rem"
            h='2rem'
            transition={{ delay: 0.5 }}
            nowrap
            autoscroll
          >
            {artist}
          </TransitionText>

          {trackPlay?.track.collection?.id &&
            <Link
              from={DJConsoleRoute.fullPath}
              to={CollectionRoute.fullPath}
              params={{ collectionId: trackPlay.track.collection.id }}>
              <Text size="0.7em" h="1.6em">{trackPlay.track.collection.description}</Text>
            </Link>
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

const ProfilePanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const currentProfileId = useRemotableProp(station, 'currentProfile');
  const profiles = useRemotableProp(station, 'profiles');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const { showContextMenu } = useContextMenu();

  const setSelection = useCallback((id: string) => {
    setSelectedId(id);
    itemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const changeProfile = useCallback((id: string) => {
    if (station?.changeProfile?.(id)) {
      setSelection(id);
    }
  }, [station]);

  useEffect(() => {
    if (currentProfileId && !selectedId) {
      setSelection(currentProfileId);
    }
  }, [currentProfileId]);

  return (
    <Panel className={classes.profile} w={240} header='PROFILES'>
      <OverlayScrollbarsComponent>
        <Flex className={classes.profileContent}>
          {profiles?.map((p) => (
            <Flex
              key={p.id}
              className={clsx(classes.item, selectedId === p.id && classes.selected)}
              ref={(el) => { itemRefs.current[p.id] = el} }
              onClick={() => setSelectedId(p.id)}
              onContextMenu={showContextMenu(
                [
                  {
                    key: 'switch',
                    title: 'Switch to this profile',
                    disabled: station === undefined,
                    onClick: () => changeProfile(p.id)
                  }
                ]
              )}
            >
              <Flex className={classes.text}>
                <Group>{p.name}</Group>
                <Group className={classes.desc}>{p.description}</Group>
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

export const TopBar: React.FC<StationIdProps> = React.memo((props) => {
  return (
    <TopBarContext.Provider value={props}>
      <Flex className={classes.topbar}>
        <Flex className={classes.main}>
          <StationPanel />
          <TrackPanel />
          <ProfilePanel />
          <Box className={classes.fill} flex='1 1 0' />
        </Flex>
        <Panel className={clsx(classes.lyricsBar)} header="LYRICS">
          <LyricsBar stationId={props.stationId} size="lg" autoscroll />
        </Panel>
      </Flex>
    </TopBarContext.Provider>
  )
});
