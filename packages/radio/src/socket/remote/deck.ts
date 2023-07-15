import { DeckPositions } from "@seamless-medley/core";
import { TrackPlay } from "../po/track";

export interface Deck extends Omit<DeckPositions, 'current'> {
  readonly active: boolean;

  readonly playing: boolean;

  readonly trackPlay?: TrackPlay;
  /**
   * Shorthand for current position
   */
  readonly cp: number;
}
