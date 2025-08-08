import type { AudioLevels } from "@seamless-medley/medley";

export type StationAudioLevels = AudioLevels & {
  reduction: number;
}

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

export type AuthData = {
  nn: number[];
  up: [number[], number[]];
}

export type PlainUser = {
  username: string;
  flags: string;
}

export type SessionData = {
  user?: PlainUser;
}
