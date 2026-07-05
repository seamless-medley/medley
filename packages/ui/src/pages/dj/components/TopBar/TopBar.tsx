import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Badge, Box, Button, Flex, Group, rem, Text, Tooltip } from "@mantine/core";
import { IconPlayerPause, IconPlayerPlay, IconPlayerTrackNext } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useContextMenu } from "mantine-contextmenu";
import { debounce, noop } from "lodash";
import type { CrateSource, SequenceChances, SequenceLimit, TrackCollection } from "@seamless-medley/remote";
import { theme } from "@ui/theme";
import { AutoScroller } from "@ui/components/AutoScroller";
import { LyricsBar } from "@ui/components/LyricsBar";
import { useRemotableProp } from "@ui/hooks/remotable";
import { usePlayingStationId } from "@ui/hooks/useClient";
import { useDeckInfo } from "@ui/hooks/useDeck";
import { useStation } from "@ui/hooks/useStation";
import { Panel } from "@ui/pages/components/Panel";
import { DJConsoleRoute } from "@ui/pages/dj/DJConsolePage/route";
import { CollectionRoute } from "@ui/pages/dj/CollectionPage/route";
import { client } from "@ui/init";
import classes from './TopBar.module.css';
import { PlayDeck } from "../PlayDeck";

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
    <Panel className={classes.station} w={240} header="Station" borders={{ right: true, bottom: true }}>
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

  const skip = useCallback(
    debounce(() => station?.skip(), 500, { leading: true, trailing: false }),
    [station]
  );

  const iconSize = rem(22);
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
          onClick={skip}
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

  const transportControl = useMemo(
    () => <TransportControl />,
    []
  )

  return (
    <Panel className={classes.playback} direction={'row'} header="Playing" borders={{ right: true, bottom: true }}>
      <PlayDeck
        stationId={stationId}
        index={activeDeck}
        controlComponent={transportControl}
      />
    </Panel>
  )
}

type SelectionStore = {
  current: string | undefined;
  listeners: Set<(id: string | undefined) => void>;
  set: (id: string) => void;
  subscribe: (fn: (id: string | undefined) => void) => () => void;
}

const ProfileSelectionContext = createContext<SelectionStore>(null!);

function useIsSelected(id: string): boolean {
  const store = useContext(ProfileSelectionContext);
  const [selected, setSelected] = useState(() => store.current === id);

  useEffect(() => {
    setSelected(store.current === id);
    return store.subscribe((current) => setSelected(current === id));
  }, [store, id]);

  return selected;
}

function useSelectedProfileId(): string | undefined {
  const store = useContext(ProfileSelectionContext);
  const [id, setId] = useState(() => store.current);

  useEffect(() => {
    setId(store.current);
    return store.subscribe(setId);
  }, [store]);

  return id;
}

type ProfileItemProps = {
  profile: { id: string; name: string; description?: string };
  currentProfileId: string | undefined;
  itemRef: (el: HTMLElement | null) => void;
  onSelect: (id: string) => void;
  onChangeProfile: (id: string) => void;
  stationDefined: boolean;
}

const ProfileItem = React.memo<ProfileItemProps>(({ profile: p, currentProfileId, itemRef, onSelect, onChangeProfile, stationDefined }) => {
  const isSelected = useIsSelected(p.id);
  const { showContextMenu } = useContextMenu();

  return (
    <Flex
      data-selected={isSelected}
      className={classes.item}
      ref={itemRef}
      gap={4}
      onClick={() => onSelect(p.id)}
      onContextMenu={showContextMenu(
        [
          {
            key: 'switch',
            title: <>Switch to <span style={{ color: theme.colors.blue[5] }}>{p.name}</span> profile</>,
            disabled: !stationDefined || (p.id === currentProfileId),
            onClick: () => onChangeProfile(p.id)
          }
        ]
      )}
    >
      <Flex className={classes.listPanelItemText}>
        <span>{p.name}</span>
        {p.description &&
          <AutoScroller>
            <Group className={classes.secondary}>{p.description}</Group>
          </AutoScroller>
        }
      </Flex>
      {p.id === currentProfileId &&
        <Group mr={4}>
          <Badge size='xs' miw='4rem' autoContrast>Current</Badge>
        </Group>
      }
    </Flex>
  );
});

const ProfilePanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const currentProfileId = useRemotableProp(station, 'currentProfile');
  const profiles = useRemotableProp(station, 'profiles');
  const store = useContext(ProfileSelectionContext);

  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const storeItemRef = useCallback((id: string) => (el: HTMLElement | null) => {
    itemRefs.current[id] = el;
  }, []);

  const setSelection = useCallback((id: string) => {
    store.set(id);
    itemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [store]);

  const changeProfile = useCallback((id: string) => {
    if (station?.changeProfile?.(id)) {
      setSelection(id);
    }
  }, [station, setSelection]);

  useEffect(() => {
    if (currentProfileId && !store.current) {
      setSelection(currentProfileId);
    }
  }, [currentProfileId]);

  return (
    <Panel.List
      w={240}
      header='Profiles'
      borders={{ right: true, bottom: true }}
      classNames={{ list: classes.listItems }}
    >
      {profiles?.map((p) => (
        <ProfileItem
          key={p.id}
          profile={p}
          currentProfileId={currentProfileId}
          itemRef={storeItemRef(p.id)}
          onSelect={setSelection}
          onChangeProfile={changeProfile}
          stationDefined={station !== undefined}
        />
      ))}
    </Panel.List>
  )
}

const CratePanel: React.FC = () => {
  const { stationId } = useContext(TopBarContext);
  const { station } = useStation(stationId);
  const [collections, setCollections] = useState<TrackCollection[]>([]);
  const profiles = useRemotableProp(station, 'profiles');
  const currentProfileId = useRemotableProp(station, 'currentProfile');
  const selectedProfileId = useSelectedProfileId();
  const crates = profiles?.find(p => p.id === selectedProfileId)?.crates ?? [];
  const currentCrate = useRemotableProp(station, 'currentCrate');
  const currentCollection = useRemotableProp(station, 'currentCollection');
  const activeDeck = useRemotableProp(station, 'activeDeck');
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const scrollOptions: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' };

  const storeItemRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (id === currentCrate && !itemRefs.current[id]) {
      el?.scrollIntoView(scrollOptions);
    }

    if (el) {
      itemRefs.current[id] = el;
    }
  }, [crates, currentCrate]);

  useEffect(() => {
    setCollections([]);
    station?.getCollections().then(setCollections);
  }, [stationId, station]);

  useEffect(() => {
    if (currentCrate) {
      itemRefs.current[currentCrate]?.scrollIntoView(scrollOptions);
    }
  }, [selectedProfileId, currentCrate, crates]);

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
    <Panel.List
      w={240}
      header='Sequences'
      borders={{ right: true, bottom: true }}
      classNames={{ list: classes.listItems }}
    >
      {collections.length && crates.map((crate) => (
        <Flex
          key={crate.id}
          className={classes.item}
          ref={storeItemRef(crate.id)}
          gap={4}
          onContextMenu={showContextMenu([
            ...(isLatching
              ? [
                { key: 'latching', title: 'Latching is active', disabled: true, onClick: noop },
              ]
              : (currentProfileId !== selectedProfileId)
                ? [
                  { key: 'profile_inactive', title: 'Profile is not active', disabled: true, onClick: noop },
                ]
                : []
            ),
            ...(!isLatching && (currentProfileId === selectedProfileId))
            ? crate.sources
              .map(s => collections.find(col => col.id === s.id))
              .filter(col => col !== undefined)
              .map(col => ({
                key: col.id,
                title: <>Play from <span style={{ color: theme.colors.blue[5] }}>{col.description}</span></>,
                disabled: (col.id === currentCollection),
                onClick: () => changeSequence(crate.id, col.id)
              }))
            : []
          ])}
        >
          <Flex className={classes.listPanelItemText}>
            <Box>
              {crate.sources.map(s =>
                <AutoScroller key={`${crate.id}:${s.id}`}>
                  <Link
                    style={{ color: 'white' }}
                    from={DJConsoleRoute.fullPath}
                    to={CollectionRoute.fullPath}
                    params={{ collectionId: s.id }}
                  >
                    {formatSource(s, crate.sources.length > 1)}
                  </Link>
                </AutoScroller>
              )}
            </Box>

            <Flex className={classes.secondary} gap={2} wrap="nowrap">
              Chances: {formatChance(crate.chances)}
            </Flex>

            <Flex className={classes.secondary} gap={0} wrap="nowrap">
              {formatLimit(crate.limit)}
            </Flex>
          </Flex>

          {crate.id === currentCrate &&
            <Group mr={4}>
              <Badge size='xs' miw='4rem' autoContrast>Current</Badge>
            </Group>
          }
        </Flex>
      ))}
    </Panel.List>
  );
}

const ProfileAndCrate: React.FC = () => {
  const store = useMemo<SelectionStore>(() => {
    const listeners = new Set<(id: string | undefined) => void>();
    return {
      current: undefined,
      listeners,
      set(id) { this.current = id; listeners.forEach(fn => fn(id)); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
  }, []);

  return (
    <ProfileSelectionContext value={store}>
      <ProfilePanel />
      <CratePanel />
    </ProfileSelectionContext>
  );
}

export const TopBar: React.FC<StationIdProps> = React.memo((props) => {
  return (
    <TopBarContext.Provider value={props}>
      <Flex className={classes.topbarWrapper}>
        <Flex className={classes.topbar} w={450 + 240}>
          <Flex className={classes.main}>
            <StationPanel />
            <TrackPanel />
          </Flex>
          <Panel className={classes.lyricsBar} header="LYRICS" borders={{ right: true, bottom: true }}>
            <LyricsBar stationId={props.stationId} size="lg" autoscroll />
          </Panel>
        </Flex>
        <ProfileAndCrate />
        <Box className={classes.fill} />
      </Flex>
    </TopBarContext.Provider>
  )
});
