import type { DeckIndex, DeckPositions } from "@seamless-medley/medley";
import type { DeckInfoWithPositions, DeckPositionsWithTrackKind } from "./deck";
import type { TrackCollection } from "./track";
import type { Chanceable, SequenceLimit } from "@seamless-medley/radio";

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
  readonly currentCollection: string | undefined;
  readonly currentProfile: string | undefined;
  readonly profiles: StationProfile[];

  start(): void;
  pause(): void;
  skip(): Promise<boolean>;

  getDeckPositions(deckIndec: DeckIndex): DeckPositions;
  getDeckInfo(deckIndex: DeckIndex): Promise<DeckInfoWithPositions>;

  getCollections(): TrackCollection[];

  changeProfile(id: string): boolean;

  ϟdeckLoaded(deckIndex: number, info: DeckInfoWithPositions): void;
  ϟdeckUnloaded(deckIndex: number): void;
  ϟdeckStarted(deckIndex: number, position: DeckPositionsWithTrackKind): void;
  ϟdeckActive(deckIndex: number, position: DeckPositionsWithTrackKind): void;

  ϟcollectionChange(prevCollection: string | undefined, newCollection: string, fromRequestTrack: boolean): void;
  ϟcrateChange: (oldCrate: string | undefined, newCrate: string) => void;
  ϟprofileChange: (oldProfile: string | undefined, newProfile: string) => void;
  ϟprofileBookChange: () => void;
}

export interface StationProfile {
  readonly id: string;

  name: string;
  description?: string;

  crates: Array<Create>;
}

export interface Create {
  readonly id: string;

  readonly sources: Array<{ id: string, weight: number }>;

  readonly limit: SequenceLimit;

  readonly chance: Chanceable['chances'];
}
