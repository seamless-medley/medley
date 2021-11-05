/// <reference types="node" />

import type { EventEmitter } from 'events';
import { Readable } from 'stream';

export interface TrackInfo {
  /**
   * Path to the physical file.
   */
  readonly path: string;

  readonly cueInPosition?: number;

  readonly cueOutPosition?: number;
}

export type TrackDescriptor<T extends TrackInfo> = string | T;

export declare class Queue<T extends TrackInfo = TrackInfo> {
  constructor(tracks?: TrackDescriptor<T> | TrackDescriptor<T>[]);

  get length(): number;

  add(track: TrackDescriptor<T> | TrackDescriptor<T>[]): void;

  /**
   * Insert track(s) at position specified by the `index` parameter.
   * @param index
   * @param track
   */
  insert(index: number, track: TrackDescriptor<T> | TrackDescriptor<T>[]): void;

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

  // /**
  //  * Delete a track specified by `track`
  //  * @param track
  //  */
  // delete(track: T): void;

  swap(index1: number, index2: number): void;
  move(currentIndex: number, newIndex: number): void;

  get(index: number): T;
  set(index: number, track: TrackDescriptor<T>): void;

  /**
   * Convert tracks list into an array
   *
   * @remarks
   * The returned array will not link with the internal listing of this `Queue`.
   *
   * @returns Array
   */
  toArray(): T[];
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

type NormalEvent = 'audioDeviceChanged';
type DeckEvent = 'loaded' | 'unloaded' | 'started' | 'finished';

export declare enum DeckIndex {
  A = 0,
  B = 1
}

export type Listener<T = void> = () => T;
export type DeckListener<T extends TrackInfo> = (deckIndex: DeckIndex, track: T) => void;
export type PreQueueListener = (done: PreQueueCallback) => void;
export type PreQueueCallback = (result: boolean) => void;

export declare class Medley<T extends TrackInfo = TrackInfo> extends EventEmitter {
  constructor(queue: Queue<T>);

  on(event: DeckEvent, listener: DeckListener<T>): this;
  once(event: DeckEvent, listener: DeckListener<T>): this;
  off(event: DeckEvent, listener: DeckListener<T>): this;

  on(event: 'preQueueNext', listener: PreQueueListener): this;
  once(event: 'preQueueNext', listener: PreQueueListener): this;
  off(event: 'preQueueNext', listener: PreQueueListener): this;

  on(event: NormalEvent, listener: Listener): this;
  once(event: NormalEvent, listener: Listener): this;
  off(event: NormalEvent, listener: Listener): this;

  /**
   * @returns `AudioLevels`
   */
  get level(): AudioLevels;

  /**
   * Reduction level in dB
   */
  get reduction(): number;

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
   * Audio volume in linear scale, `0` = silent, `1` = 0dBFS
   */
  get volume(): number;
  set volume(value: number);

  /**
   * S-Curve for fading in/out, range from `0` to `100`
   */
  get fadingCurve(): number;
  set fadingCurve(value: number);

  /**
   * The maximum duration in seconds for the fade-out transition between tracks.
   */
  get maximumFadeOutDuration(): number;
  set maximumFadeOutDuration(value: number);

  /**
   * The duration in seconds at the beginning of a track to be considered as having a long intro.
   *
   * A track with a long intro will cause a fading-in to occur during transition.
   */
  get minimumLeadingToFade(): number;
  set minimumLeadingToFade(value: number);

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

  isTrackLoadable(track: TrackDescriptor): boolean;

  getMetadata(index: DeckIndex): Metadata;

  requestAudioStream(options: RequestAudioStreamOptions): RequestAudioStreamResult;
}

export type AudioFormat = 'Int16LE' | 'Int16BE' | 'FloatLE' | 'FloatBE';

export type RequestAudioStreamOptions = {
  sampleRate?: number;
  /**
   * Buffer size, in frames
   */
  bufferSize?: number;
  format: AudioFormat;
}

export type RequestAudioStreamResult = {
  readonly stream: Readable;
  readonly id: number;
  readonly channels: number;
  readonly originalSampleRate: number;
  readonly sampleRate: number;
  readonly bitPerSample: number;
}

export type AudioDeviceTypeInfo = {
  type: string;
  isCurrent: boolean;
  devices: string[];
  defaultDevice: string;
  currentDevice?: string;
}

export type Metadata = {
  title: string;
  artist: string;
  album: string;
  trackGain: number;
}