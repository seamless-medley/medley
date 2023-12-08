import { noop } from "lodash";
import { type Collection } from "../../../remotes/core/collection";
import { StubOf } from "../../../socket";

export const StubCollection = StubOf<Collection>(class StubbingCollecting {
  id = undefined as any;
  description = undefined as any;
  options = undefined as any;
  length = undefined as any;
  ready = undefined as any;

  clear = noop as any;
  shuffle = noop as any;
  all = noop as any;
});
