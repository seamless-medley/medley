import type { DeckIndex, DeckPositions } from "@seamless-medley/medley";
import type { DeckInfoWithPositions, DeckPositionsWithTrackKind } from "./deck";
import type { TrackCollection } from "./track";


export type PlayState = 'idle' | 'playing' | 'paused';

export interface Station {
  readonly id: string;

  name: string;
  description?: string;

  readonly playing: boolean;
  readonly paused: boolean;
  readonly playState: PlayState;
  readonly activeDeck: DeckIndex | undefined;
  readonly audienceCount: number;

  start(): void;
  pause(): void;
  skip(): Promise<boolean>;

  getDeckPositions(deckIndec: DeckIndex): DeckPositions;
  getDeckInfo(deckIndex: DeckIndex): Promise<DeckInfoWithPositions>;

  getCurrentCollection(): string | undefined;
  getCollections(): TrackCollection[];

  ϟdeckLoaded(deckIndex: number, info: DeckInfoWithPositions): void;
  ϟdeckUnloaded(deckIndex: number): void;
  ϟdeckStarted(deckIndex: number, position: DeckPositionsWithTrackKind): void;
  ϟdeckActive(deckIndex: number, position: DeckPositionsWithTrackKind): void;

  ϟcollectionChange(prevCollection: string | undefined, newCollection: string, fromRequestTrack: boolean): void;
  ϟcrateChange: (oldCrate: string | undefined, newCrate: string) => void;
}
