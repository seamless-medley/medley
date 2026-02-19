import { useCallback, useEffect, useRef } from "react";
import { useDebouncedState } from "@mantine/hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BaseCollectionView, Remotable } from "@seamless-medley/remote";

export type UseCollectionListOptions<Item, ItemData> = Omit<Parameters<typeof useVirtualizer>[0], 'getScrollElement'> & {
  getItemData: (item: Item) => ItemData;
}

export function useCollectionList<Item, ItemData>(view: Remotable<BaseCollectionView<Item>> | undefined, options: UseCollectionListOptions<Item, ItemData>) {
  const containerRef = useRef(null);

  const virtualizer = useVirtualizer({
    getScrollElement: () => containerRef.current,
    count: options.count,
    estimateSize: options.estimateSize,
    overscan: options.overscan
  });

  // The virtual items
  const virtualItems = virtualizer.getVirtualItems();
  // The index for the top most in the table viewport
  const topIndex = virtualItems.at(0)?.index ?? 0;

  // The actual tracks list, the setter is equiped with debouncer
  const [items, setItems] = useDebouncedState<Array<ItemData>>([], 1000 / 120);

  // A function to fetch items
  const fetchView = useCallback(async () => {
    if (!view) {
      return;
    }

    const trackList = await view.itemsWithIndexes();

    setItems(trackList.reduce((o, [index, track]) => {
      o[index] = options.getItemData(track);
      return o;
    }, {} as Array<ItemData>));
  }, [view]);

  // scroll to top when collection changed
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [view]);

  // Update the remote view whe the table moves
  useEffect(() => {
    if (!view) {
      setItems([]);
      return;
    }

    view.updateView(topIndex, virtualItems.length).then(fetchView);
  }, [view, topIndex, virtualItems.length]);

  return {
    ref: containerRef,
    virtualizer,
    virtualItems,
    items
  }
}
