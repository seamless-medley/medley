import type { DeckPositions } from "@seamless-medley/medley";
import type { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";

import type { TrackKind, TrackPlay } from "./track";
import type { DeckInfo as CoreDeckInfo } from '../../../core';

export type DeckInfo = Simplify<Writable<
  ConditionalPick<CoreDeckInfo, Jsonifiable | undefined> & {
    trackPlay?: TrackPlay
  }
>>;

export type DeckInfoWithPositions = DeckInfo & {
  positions: DeckPositions;
}

export type DeckPositionsWithTrackKind = DeckPositions & {
  kind?: TrackKind;
}

export interface Deck extends Omit<DeckPositions, 'current'> {
  readonly active: boolean;

  readonly playing: boolean;

  readonly trackPlay?: TrackPlay;
  /**
   * Shorthand for current position
   */
  readonly cp: number;
}
