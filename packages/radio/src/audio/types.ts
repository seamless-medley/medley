import type { DeckIndex } from "@seamless-medley/core";

export type Level = [mag: number, peak: number];

export type AudioTransportExtra = [deck: DeckIndex | undefined, position: number, left: Level, right: Level, reduction: number];
