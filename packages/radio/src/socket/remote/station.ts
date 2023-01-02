import { PlayState } from "@seamless-medley/core";

export interface Station {
  readonly playing: boolean;
  readonly paused: boolean;
  readonly playState: PlayState;

  start(): void;
  pause(): void;
  skip(): boolean;
}
