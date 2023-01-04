import { PlayState } from "@seamless-medley/core";
import * as po from "../po/track";

export interface Station {
  readonly playing: boolean;
  readonly paused: boolean;
  readonly playState: PlayState;

  start(): void;
  pause(): void;
  skip(): Promise<boolean>;

  ϟtrackStarted(deckIndex: number, trackPlay: po.TrackPlay): void;
}
