import { noop } from "lodash";
import { StubOf } from "@ui/stubs";
import type { CollectionView, Collection } from "@seamless-medley/remote";

export const StubCollection = StubOf<Collection>(class StubbingCollection {
  id = undefined as any;
  description = undefined as any;
  options = undefined as any;
  length = undefined as any;
  ready = undefined as any;

  clear = noop as any;
  shuffle = noop as any;
  all = noop as any;
  createView = noop as any;
});

export const StubCollectionView = StubOf<CollectionView>(class StubbingCollectionView {
  length = undefined as any;

  topIndex = undefined as any;

  bottomIndex = undefined as any;

  ranges = undefined as any;

  dispose = noop as any;

  updateView = noop as any;

  absolute = noop as any;

  isIndexInView = noop as any;

  at = noop as any;

  items = noop as any;

  itemsWithIndexes = noop as any;
});
