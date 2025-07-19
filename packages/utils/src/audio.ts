export const decibelsToGain = (decibels: number): number => decibels > -100 ? Math.pow(10, decibels * 0.05) : 0;

export const gainToDecibels = (gain: number): number => gain > 0 ? Math.max(-100, Math.log10(gain) * 20) : -100;
