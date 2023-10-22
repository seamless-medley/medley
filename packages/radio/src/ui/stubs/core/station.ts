import { noop } from "lodash";
import { Station } from "../../../remotes/core";
import { StubOf } from "../../../socket/stub";

class StubbingStation {
  id = undefined as any;

  name = undefined as any;
  description = undefined as any;

  playing = undefined as any;
  paused = undefined as any;

  playState = undefined as any;
  activeDeck = undefined as any;

  start = noop as any;
  pause = noop as any;
  skip = noop as any;

  getDeckPositions = noop as any;
  getDeckInfo = noop as any;

  getCurrentCollection = noop as any;
  getCollections = noop as any;
}

export const StubStation = StubOf<Station>(StubbingStation);
