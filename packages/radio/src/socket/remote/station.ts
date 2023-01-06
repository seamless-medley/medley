import { DeckIndex, DeckPositions, PlayState } from "@seamless-medley/core";
import * as deckPO from "../po/deck";

export interface Station {
  readonly id: string;
  readonly name: string;
  readonly description?: string;

  readonly playing: boolean;
  readonly paused: boolean;
  readonly playState: PlayState;

  start(): void;
  pause(): void;
  skip(): Promise<boolean>;

  getDeckPositions(deckIndec: DeckIndex): DeckPositions;
  getDeckInfo(deckIndex: DeckIndex): Promise<deckPO.DeckInfoWithPositions>;

  ϟdeckLoaded(deckIndex: number, info: deckPO.DeckInfoWithPositions): void;
  ϟdeckUnloaded(deckIndex: number): void;
  ϟdeckStarted(deckIndex: number, position: DeckPositions): void;
  ϟdeckActive(deckIndex: number, position: DeckPositions): void;
}
