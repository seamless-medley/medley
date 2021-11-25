import { Medley, Metadata, CoverAndLyrics } from "@medley/medley";

export const getMusicMetadata = (path: string) => new Promise<Metadata>(resolve => resolve(Medley.getMetadata(path)));

export const getMusicCoverAndLyrics = (path: string) => new Promise<CoverAndLyrics>(resolve => resolve(Medley.getCoverAndLyrics(path)));

export const decibelsToGain = (decibels: number): number => decibels > -100 ? Math.pow(10, decibels * 0.05) : 0;

export const gainToDecibels = (gain: number): number => gain > 0 ? Math.max(-100, Math.log10(gain) * 20) : -100;