import { useCallback, useEffect, useRef } from "react";
import { useDebouncedState } from "@mantine/hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BaseCollectionView, Remotable } from "@seamless-medley/remote";

type UseVirtualizerOptions = Parameters<typeof useVirtualizer>[0];

type BaseOptions<Item, ItemData> = Omit<UseVirtualizerOptions, 'getScrollElement' | 'estimateSize'> & {
  getItemData: (item: Item) => ItemData;
}

export type UseCollectionListVirtualOptions<Item, ItemData> = BaseOptions<Item, ItemData> & {
  virtualize?: true | undefined;
  estimateSize: UseVirtualizerOptions['estimateSize'];
  getScrollElement?: UseVirtualizerOptions['getScrollElement'];
}

export type UseCollectionListNonVirtualOptions<Item, ItemData> = BaseOptions<Item, ItemData> & {
  virtualize: false;
}

export type UseCollectionListOptions<Item, ItemData> =
  | UseCollectionListVirtualOptions<Item, ItemData>
  | UseCollectionListNonVirtualOptions<Item, ItemData>;

export function useCollectionList<Item, ItemData>(view: Remotable<BaseCollectionView<Item>> | undefined, options: UseCollectionListOptions<Item, ItemData>) {
  const virtualize = options.virtualize !== false;

  const containerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    getScrollElement: () => containerRef.current,
    count: options.count,
    estimateSize: (virtualize ? options.estimateSize : undefined) ?? (() => 0),
    overscan: options.overscan
  });

  // The virtual items
  const virtualItems = virtualizer.getVirtualItems();
  // The index for the top most in the table viewport
  const topIndex = virtualize ? (virtualItems.at(0)?.index ?? 0) : 0;
  const windowLength = virtualize ? virtualItems.length : options.count;

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

    const onViewChange = () => view.updateView(topIndex, windowLength).then(fetchView);

    view.on('viewChange', onViewChange);

    return () => {
      view?.off('viewChange', onViewChange);
    }
  }, [view, fetchView, topIndex, windowLength]);

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
    view.updateView(topIndex, windowLength).then(fetchView);
  }, [view, topIndex, windowLength, options.count]);

  return {
    ref: containerRef,
    virtualizer,
    virtualItems,
    items
  }
}
