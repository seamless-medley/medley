import { StubOf } from "../../../socket/stub";
import { type Deck } from "../../../remotes/core/deck";

export const StubDeck = StubOf<Deck>(class StubbingDeck {
  active = undefined as any;

  playing = undefined as any;

  trackPlay = undefined as any;

  cp = undefined as any;

  current = undefined as any;

  duration = undefined as any;

  first = undefined as any;

  last = undefined as any;

  leading = undefined as any;

  trailing = undefined as any;

  cuePoint = undefined as any;

  transitionStart = undefined as any;

  transitionEnd = undefined as any;
});
