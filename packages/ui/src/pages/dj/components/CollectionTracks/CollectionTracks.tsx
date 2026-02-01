import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Flex, Group, Table, px } from "@mantine/core";
import { useDebouncedState } from "@mantine/hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AutoScroller } from "@ui/components/AutoScroller";
import type { Collection, CollectionView, MetadataOnlyTrack, Remotable, TrackKind } from "@seamless-medley/remote";

import { range } from "lodash";
import { extractArtists, selectConsistentValue } from "@seamless-medley/utils";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useContextMenu } from "mantine-contextmenu";
import { IconArrowsShuffle } from "@tabler/icons-react";
import { contextMenuClassNames } from "@ui/theme";
import classes from './CollectionTracks.module.css';

type TrackRowData = {
  id: string;
  kind?: TrackKind;
  artist?: string;
  title?: string;
  album?: string;
}

export type TrackItemProps = {
  size: number;
  start: number;
  data?: TrackRowData;
  onContextMenu?: React.MouseEventHandler<HTMLTableRowElement>;
}

const colors = range(1, 10)
  .flatMap(shade => ['red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'green', 'lime', 'yellow', 'orange', 'teal'].map(name => `${name}.${shade}`));

export const TrackItem = (props: TrackItemProps) => {
  const { start, size, data, onContextMenu } = props;

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
    <Table.Tr
      display='flex'
      pos='absolute'
      w='100%'
      h={size}
      style={{ transform: `translateY(${start}px)` }}
      onContextMenu={onContextMenu}
    >
      {children}
    </Table.Tr>
  )
}

const trackToRowData = ([id, kind, artist, title, album]: MetadataOnlyTrack): TrackRowData => ({ id, kind, artist, title, album });

export function CollectionTracks(props: { collection: Remotable<Collection> | undefined}) {
  const { collection } = props;
  const count = useRemotableProp(collection, 'length', 0);

  const tableRef = useRef(null);

  // virtual table
  const virt = useVirtualizer({
    count,
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

  const { showContextMenu } = useContextMenu();

  return (
    <Flex ref={tableRef} mih={0} className={classes.container}>
      <Table>
        <Table.Thead pos="sticky" bg="dark.7">
          <Table.Tr display="flex" fw='bold'>
            <Table.Td w="50%">
              Artist
            </Table.Td>
            <Table.Td w="50%">
              Title
            </Table.Td>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody
          pos='relative'
          w='100%'
          h={virt.getTotalSize()}
          className={classes.listBody}
        >
          {virtualItems.map(vrow => <TrackItem
            key={tracks[vrow.index]?.id ?? vrow.index}
            size={vrow.size}
            start={vrow.start}
            data={tracks[vrow.index]}
            onContextMenu={showContextMenu(
              [
                {
                  key: 'shuffle',
                  title: 'Shuffle',
                  icon: <IconArrowsShuffle stroke={1} />,
                  // disabled: collection?.options()?.auxiliary,
                  onClick: () => collection?.shuffle()
                }
              ],
              {
                className: contextMenuClassNames.root
              }
            )}
          />)}
        </Table.Tbody>
      </Table>
    </Flex>
  )
}
