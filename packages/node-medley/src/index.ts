import { inherits } from 'util';
import { EventEmitter } from 'events';
const medley = require('bindings')('medley');

inherits(medley.Medley, EventEmitter);

exports.Medley = medley.Medley;
exports.Queue = medley.Queue;

export interface TrackInfo {
  path: string;
  preGain: number;
}

export type TrackDescriptor = string | TrackInfo;

export declare class Queue {
  constructor(tracks?: TrackDescriptor[]);

  get length(): number;

  add(track: TrackDescriptor | TrackDescriptor[]): void;
  insert(index: number, track: TrackDescriptor | TrackDescriptor[]): void;
  delete(index: number): void;
  delete(from: number, count: number): void;
  delete(track: TrackDescriptor): void;
  swap(index1: number, index2: number): void;
  move(currentIndex: number, newIndex: number): void;

  get(index: number): TrackInfo;
  set(index: number, track: TrackDescriptor): void;

  toArray(): TrackInfo[];
}

export interface AudioLevel {
  magnitude: number;
  peak: number;
}

export interface AudioLevels {
  left: AudioLevel;
  right: AudioLevel;
}

type DeckEvent = 'loaded' | 'unloaded' | 'started' | 'finished';

export declare class Medley extends EventEmitter {
  constructor(queue: Queue);

  on(event: DeckEvent, listener: (deckIndex: number) => void): this;
  once(event: DeckEvent, listener: (deckIndex: number) => void): this;
  off(event: DeckEvent, listener: (deckIndex: number) => void): this;

  get level(): AudioLevels;
  get playing(): boolean;
  get paused(): boolean;
  get duration(): number;
  get position(): number;
  set position(time: number);

  get gain(): number;
  set gain(value: number);

  play(): void;
  stop(): void;
  togglePause(): void;
  fadeOut(): void;
  seek(time: number): void;
  seekFractional(fraction: number): void;
}