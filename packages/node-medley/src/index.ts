module.exports =  require('bindings')('medley');

export interface TrackInfo {
  path: string;
  preGain: number;
}

export type TrackDescriptor = string | TrackInfo;

export declare class Queue {
  get length(): number;

  add(track: TrackDescriptor): void;
}

export interface AudioLevel {
  magnitude: number;
  peak: number;
}

export interface AudioLevels {
  left: AudioLevel;
  right: AudioLevel;
}

export declare class Medley {
  constructor(queue: Queue);

  get level(): AudioLevels;

  play(): void;
  stop(): void;
}