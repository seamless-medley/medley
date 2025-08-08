import { noop } from "lodash";
import { StubOf } from "../stub";
import type { Collection } from "@seamless-medley/remote";

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
