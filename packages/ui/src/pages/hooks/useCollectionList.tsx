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

    const itemList = await view.itemsWithIndexes();

    setItems(itemList.reduce((o, [index, track]) => {
      o[index] = options.getItemData(track);
      return o;
    }, [] as Array<ItemData>));
  }, [view, options.getItemData]);

  // scroll to top when collection changed
  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [view]);

  // Listen for `viewChange` event from the server
  useEffect(() => {
    if (!view) {
      return;
    }

    const onViewChange = () => view.updateView(topIndex, virtualItems.length).then(fetchView);

    view.on('viewChange', onViewChange);

    return () => {
      view?.off('viewChange', onViewChange);
    }
  }, [view, fetchView, topIndex, virtualItems.length]);

  // Dispose view when it changes or unmounts
  useEffect(() => {
    return () => {
      view?.dispose();
    }
  }, [view]);

  // Update the remote view when the table moves or total count changes
  useEffect(() => {
    if (!view) {
      setItems([]);
      return;
    }

    view.updateView(topIndex, virtualItems.length).then(fetchView);
  }, [view, topIndex, virtualItems.length, options.count]);

  return {
    ref: containerRef,
    virtualizer,
    virtualItems,
    items
  }
}
