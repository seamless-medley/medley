import { ConditionalPick, Jsonifiable, Simplify, Writable } from "type-fest";
import * as core from '@seamless-medley/core';
import { fromBoomBoxTrackPlay, TrackPlay } from "./track";
import { DeckPositions } from "@seamless-medley/core";

export type DeckInfo = Simplify<Writable<
  ConditionalPick<core.DeckInfo, Jsonifiable | undefined> & {
    trackPlay?: TrackPlay
  }
>>;

export type DeckInfoWithPositions = DeckInfo & {
  positions: DeckPositions;
}

export const fromDeckInfo = async ({ trackPlay, active, playing }: core.DeckInfo): Promise<DeckInfo> => ({
  trackPlay: trackPlay ? await fromBoomBoxTrackPlay(trackPlay) : undefined,
  active,
  playing
});

export const fromDeckInfoWithPositions = async (p: core.DeckInfoWithPositions): Promise<DeckInfoWithPositions> => ({
  ...await fromDeckInfo(p),
  positions: p.positions
})
