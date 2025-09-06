import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Box, Group, Table, px } from "@mantine/core";
import { useDebouncedState } from "@mantine/hooks";
import { styled } from "@linaria/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AutoScroller } from "@ui/components/AutoScoller";
import type { Collection, CollectionView, MetadataOnlyTrack, Remotable, TrackKind } from "@seamless-medley/remote";

import { range } from "lodash";
import { extractArtists, selectConsistentValue } from "@seamless-medley/utils";

type TrackRowData = {
  id: string;
  kind?: TrackKind;
  artist?: string;
  title?: string;
  album?: string;
}

const TrackListContainer = styled(Box)`
  overflow: hidden auto;
  flex: 1;
  min-height: 0; // Critical for flex child with overflow
`;

const TrackListBody = styled(Table.Tbody)`
  position: relative;
  width: 100%;
  will-change: transform;
`;

const TrackRow = styled(Table.Tr)`
  display: flex;
  position: absolute;
  width: 100%;
`;

export type TrackItemProps = {
  size: number;
  start: number;
  data?: TrackRowData;
}

const colors = range(1, 10)
  .flatMap(shade => ['red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'green', 'lime', 'yellow', 'orange', 'teal'].map(name => `${name}.${shade}`));

export const TrackItem = (props: TrackItemProps) => {
  const { start, size, data } = props;

  const artists = data ? extractArtists(data.artist ?? '') : [];

  const children = data
    ? (
      <>
        <Table.Td w="50%">
          <AutoScroller stableId={`artists:${data.id}`}>
            <Group gap="0.5em" wrap="nowrap">
              {artists.map((a, i) => (
                <Badge
                  key={i}
                  autoContrast={true}
                  fw="normal"
                  color={selectConsistentValue(a, colors)}
                  styles={{
                    root: { textTransform: 'none' },
                    label: { overflow: 'visible' }
                  }}
                >
                  {a}
                </Badge>
              ))}
            </Group>
          </AutoScroller>
        </Table.Td>

        <Table.Td w="50%">
          <AutoScroller>
            {data.title}
          </AutoScroller>
        </Table.Td>
      </>
    )
    : (
      <Table.Td c="gray.6">
        Loading...
      </Table.Td>
    )

  return (
    <TrackRow h={size} style={{ transform: `translateY(${start}px)` }}>
      {children}
    </TrackRow>
  )
}

const trackToRowData = ([id, kind, artist, title, album]: MetadataOnlyTrack): TrackRowData => ({ id, kind, artist, title, album });

export function CollectionTracks(props: { collection: Remotable<Collection> | undefined}) {
  const { collection } = props;
  const tableRef = useRef(null);

  // virtual table
  const virt = useVirtualizer({
    count: collection?.length() ?? 0,
    getScrollElement: () => tableRef.current,
    estimateSize: () => +px('2.25em'),
    overscan: 20
  });

  // scroll to top when collection changed
  useEffect(() => {
    virt.scrollToOffset(0)
  }, [collection]);

  // Remote view, only gets data needed for display
  const [view, setView] = useState<Remotable<CollectionView>>();

  // The virtual items
  const virtualItems = virt.getVirtualItems();
  // The index for the top most in the table viewport
  const topIndex = virtualItems.at(0)?.index ?? 0;

  // Create remote view when the collection changed
  useEffect(() => {
    if (!collection) {
      return;
    }

    collection.createView(virtualItems.length, topIndex).then(setView);
  }, [collection]);

  // A function to fetch items
  const fetchView = useCallback(async () => {
    if (!view) {
      return;
    }

    const trackList = await view.itemsWithIndexes();

    const tracks = trackList.reduce((o, [index, track]) => {
      o[index] = trackToRowData(track);
      return o;
    }, {} as Array<TrackRowData>);

    setTracks(tracks);
  }, [view]);

  // Listen for `viewChange` event from the server
  useEffect(() => {
    if (!view) {
      return;
    }

    view.on('viewChange', fetchView);

    return () => {
      view?.off('viewChange', fetchView);
      view?.dispose();
    }
  }, [view]);

  // The actual tracks list, the setter is equiped with debouncer
  const [tracks, setTracks] = useDebouncedState<Array<TrackRowData>>([], 1000 / 120);

  // Update the remote view whe the table moves
  useEffect(() => {
    if (!view) {
      setTracks([]);
      return;
    }

    view.updateView(topIndex, virtualItems.length).then(fetchView);
  }, [view, topIndex, virtualItems.length]);

  return (
    <TrackListContainer ref={tableRef}>
      <Table>
        <Table.Thead pos="sticky" bg="dark.8">
          <Table.Tr display="flex" fw='bold'>
            <Table.Td w="50%">
              Artist
            </Table.Td>
            <Table.Td w="50%">
              Title
            </Table.Td>
          </Table.Tr>
        </Table.Thead>

        <TrackListBody h={virt.getTotalSize()}>
          {virtualItems.map(vrow => <TrackItem
            key={tracks[vrow.index]?.id ?? vrow.index}
            size={vrow.size}
            start={vrow.start}
            data={tracks[vrow.index]}
          />)}
        </TrackListBody>
      </Table>
    </TrackListContainer>
  )
}
