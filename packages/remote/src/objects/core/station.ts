import type { DeckIndex, DeckPositions } from "@seamless-medley/medley";
import type { DeckInfoWithPositions, DeckPositionsWithTrackKind } from "./deck";
import type { Track, TrackCollection } from "./track";
import type {
  Requester as CoreRequester,
  DiscordRequester as CoreDiscordRequester,
  SequenceChances,
  SequenceLimit
} from "@seamless-medley/radio";

import { BaseCollectionView } from "./collection";
import { Remotable } from "../../type-utils";
import { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";

export type { SequenceLimit, SequenceChances } from '@seamless-medley/radio';

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
  readonly currentCrate: string | undefined;
  readonly requestsCount: number;

  start(): void;
  pause(): void;
  skip(): Promise<boolean>;

  getDeckPositions(deckIndec: DeckIndex): DeckPositions;
  getDeckInfo(deckIndex: DeckIndex): Promise<DeckInfoWithPositions>;

  getCollections(): TrackCollection[];

  changeProfile(id: string): boolean;
  changePlaySequence(crateId: string, collectionId: string): true | string;

  createRequestView(topIndex: number): Remotable<RequestCollectionView>;

  ϟdeckLoaded(deckIndex: number, info: DeckInfoWithPositions): void;
  ϟdeckUnloaded(deckIndex: number): void;
  ϟdeckStarted(deckIndex: number, position: DeckPositionsWithTrackKind): void;
  ϟdeckActive(deckIndex: number, position: DeckPositionsWithTrackKind): void;

  ϟcollectionChange(prevCollection: string | undefined, newCollection: string, fromRequestTrack: boolean): void;
  ϟcrateChange: (oldCrate: string | undefined, newCrate: string) => void;
  ϟprofileChange: (oldProfile: string | undefined, newProfile: string) => void;
  ϟprofileBookChange: () => void;
  ϟrequestTrackAdded: () => void;
  ϟrequestTracksRemoved: () => void;
}

export interface StationProfile {
  readonly id: string;

  name: string;
  description?: string;

  crates: Array<Create>;
}

export type CrateSource = {
  id: string;
  weight: number;
}

export interface Create {
  readonly id: string;

  readonly sources: Array<CrateSource>;

  readonly limit: SequenceLimit;

  readonly chances: SequenceChances;
}

export type DiscordRequester = Simplify<ConditionalPick<Omit<CoreDiscordRequester, 'data'>, Jsonifiable | undefined> & {
  data?: {
    displayName: string;
    avatar?: string;
    guild: {
      id: string;
      name: string;
      icon?: string;
    }
  }
}>;

export type Requester = Simplify<Writable<
  DiscordRequester | ConditionalPick<Exclude<CoreRequester, CoreDiscordRequester>, Jsonifiable | undefined>
>>;

export type RequestTrackRecord = [
  id: Track['id'],
  artist: string | undefined,
  title: string | undefined,
  requesters: Requester[],
];

export interface RequestCollectionView extends BaseCollectionView<RequestTrackRecord> {

}
