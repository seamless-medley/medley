import type { DeckIndex, StationAudioLevels } from "@seamless-medley/core";

export type AudioTransportExtraPayload = [
  left_mag: number,
  left_peak: number,
  right_mag: number,
  right_peak: number,
  reduction: number
];

export type AudioTransportExtra = {
  audioLevels: StationAudioLevels;
}

