import { EventEmitter } from 'events';

export interface TrackInfo {
  /**
   * Path to the physical file.
   */
  path: string;

  /**
   *
   * @default 1.0
   */
  preGain: number;
}

export type TrackDescriptor = string | TrackInfo;

export declare class Queue {
  constructor(tracks?: TrackDescriptor[]);

  get length(): number;

  add(track: TrackDescriptor | TrackDescriptor[]): void;

  /**
   * Insert track(s) at position specified by the `index` parameter.
   * @param index
   * @param track
   */
  insert(index: number, track: TrackDescriptor | TrackDescriptor[]): void;

  /**
   * Delete a track at `index`
   * @param index
   */
  delete(index: number): void;

  /**
   * Delete number of tracks specified by `count` starting from `from`
   * @param from
   * @param count
   */
  delete(from: number, count: number): void;

  /**
   * Delete a track specified by `track`
   * @param track
   */
  delete(track: TrackDescriptor): void;

  swap(index1: number, index2: number): void;
  move(currentIndex: number, newIndex: number): void;

  get(index: number): TrackInfo;
  set(index: number, track: TrackDescriptor): void;

  /**
   * Convert tracks list into an array
   *
   * @remarks
   * The returned array will not link with the internal listing of this `Queue`.
   *
   * @returns Array
   */
  toArray(): TrackInfo[];
}

export interface AudioLevel {
  magnitude: number;
  peak: number;
}

export interface AudioLevels {
  /**
   * Audio level for left channel
   */
  left: AudioLevel;

  /**
   * Audio level for right channel
   */
  right: AudioLevel;
}

type NormalEvent = 'audioDeviceChanged' | 'preCueNext';
type DeckEvent = 'loaded' | 'unloaded' | 'started' | 'finished';

export declare class Medley extends EventEmitter {
  constructor(queue: Queue);

  on(event: DeckEvent, listener: (deckIndex: number) => void): this;
  once(event: DeckEvent, listener: (deckIndex: number) => void): this;
  off(event: DeckEvent, listener: (deckIndex: number) => void): this;

  on(event: NormalEvent, listener: () => void): this;
  once(event: NormalEvent, listener: () => void): this;
  off(event: NormalEvent, listener: () => void): this;



  /**
   * @returns `AudioLevels`
   */
  get level(): AudioLevels;

  /**
   * @returns `true` if the engine is running, `false` otherwise.
   *
   * @remarks This is not affected by `paused` property.
   */
  get playing(): boolean;

  get paused(): boolean;

  get duration(): number;

  /**
   * The playing position of the current track in seconds.
   */
  get position(): number;
  set position(time: number);

  /**
   * Audio gain in linear value, `0` = silent, `1` = 0dBFS
   */
  get gain(): number;
  set gain(value: number);

  /**
   * S-Curve for fading in/out, range from `0` to `100`
   */
  get fadingCurve(): number;
  set fadingCurve(value: number);

  /**
   * The maximum duration in seconds for the transition between tracks should occur.
   */
  get maxTransitionTime(): number;
  set maxTransitionTime(value: number);

  /**
   * The maximum duration in seconds at the beginning of a track to be considered as having a long intro.
   *
   * A track with a long intro will cause a fading-in to occur during transition.
   */
  get maxLeadingDuration(): number;
  set maxLeadingDuration(value: number);

  /**
   * Start the engine, also clear the `paused` state.
   */
  play(): void;

  /**
   * Stop the engine and unload track(s).
   */
  stop(): void;

  togglePause(): void;

  /**
   * Force fading out and unloading of the current track.
   */
  fadeOut(): void;

  /**
   * Seek, this has the same effect as setting `position` property.
   * @param time in seconds
   */
  seek(time: number): void;

  /**
   * Seek
   * @param fraction
   *
   * @example
   * seek(0) - Seek to the beginning.
   * seek(0.5) - Seek to the middle of a track.
   */
  seekFractional(fraction: number): void;

  getAvailableDevices(): AudioDeviceTypeInfo[];

  setAudioDevice(descriptor: { type?: string, device: string }): boolean;
}

export type AudioDeviceTypeInfo = {
  type: string;
  isCurrent: boolean;
  devices: string[];
  defaultDevice: string;
  currentDevice?: string;
}