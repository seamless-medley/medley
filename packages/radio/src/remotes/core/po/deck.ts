import { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";
import {
  type DeckInfo as CoreDeckInfo,
  type DeckInfoWithPositions as CoreDeckInfoWithPositions
} from '@seamless-medley/core';
import { toTrackPlay, TrackKind, TrackPlay } from "./track";
import { type DeckPositions } from "@seamless-medley/core";

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

export const fromDeckInfo = async ({ trackPlay, active, playing }: CoreDeckInfo): Promise<DeckInfo> => ({
  trackPlay: trackPlay ? await toTrackPlay(trackPlay) : undefined,
  active,
  playing
});

export const fromDeckInfoWithPositions = async (p: CoreDeckInfoWithPositions): Promise<DeckInfoWithPositions> => ({
  ...await fromDeckInfo(p),
  positions: p.positions
})
