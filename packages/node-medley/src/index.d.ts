/// <reference types="node" />

import type { EventEmitter } from 'node:events';
import type { Readable } from 'stream';

export interface TrackInfo {
  /**
   * Path to the physical file.
   */
  readonly path: string;

  /**
   * Start position of the track
   *
   * Setting this property will also disable lead-in
   */
  readonly cueInPosition?: number;

  /**
   * Stop position of the track
   */
  readonly cueOutPosition?: number;

  /**
   * Disable lead-in of the next track, useful for transiting from jingle/sweeper
   *
   * The lead-in is the position where it is considered as the start singing point,
   * usually presented in a track which has smooth beginning.
   */
  readonly disableNextLeadIn?: boolean;
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
type DeckEvent = 'loaded' | 'unloaded' | 'started' | 'finished' | 'mainDeckChanged';

export declare enum DeckIndex {
  A = 0,
  B = 1,
  C = 2
}

export type TrackPlay<T extends TrackInfo> = {
  uuid: string;
  track: T;
  duration: number;
}

export type Listener<T = void> = () => T;
export type DeckListener<T extends TrackInfo> = (deckIndex: DeckIndex, trackPlay: TrackPlay<T>) => void;
export type EnqueueCallback = (result: boolean) => void;
export type EnqueueListener = (done: EnqueueCallback) => void;

export declare class Medley<T extends TrackInfo = TrackInfo> {
  constructor(queue: Queue<T>);

  on(event: DeckEvent, listener: DeckListener<T>): this;
  once(event: DeckEvent, listener: DeckListener<T>): this;
  off(event: DeckEvent, listener: DeckListener<T>): this;

  on(event: 'enqueueNext', listener: EnqueueListener): this;
  once(event: 'enqueueNext', listener: EnqueueListener): this;
  off(event: 'enqueueNext', listener: EnqueueListener): this;

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
   * Gain (in dB) to boost for tracks with ReplayGain, default to 9.0dB
   * If the track has no ReplayGain metadata, this value is ignored.
   *
   * @default 9.0
   */
  get replayGainBoost(): number;
  set replayGainBoost(decibels: number);

  /**
   * Start the engine, also clear the `paused` state.
   */
  play(shouldFade: boolean = true): boolean;

  /**
   * Stop the engine and unload track(s).
   */
  stop(shouldFade: boolean = true): void;

  togglePause(fade: boolean = true): void;

  /**
   * Force fading out and unloading of the current track.
   */
  fadeOut(): boolean;

  /**
   * Seek the main deck
   * @param time in seconds
   * @param index Deck index, omit to seek on the main deck
   */
  seek(time: number, index?: DeckIndex): void;

  /**
   * Seek
   * @param fraction
   * @param index Deck index, omit to seek on the main deck
   *
   * @example
   * seek(0) - Seek to the beginning.
   * seek(0.5) - Seek to the middle of a track.
   */
  seekFractional(fraction: number, index?: DeckIndex): void;

  getAvailableDevices(): AudioDeviceTypeInfo[];

  setAudioDevice(descriptor: Partial<AudioDeviceDescriptor>): boolean;

  getAudioDevice(): AudioDeviceDescriptor;

  getDeckMetadata(index: DeckIndex): Metadata;

  getDeckPositions(index: DeckIndex): DeckPositions;

  async requestAudioStream(options?: RequestAudioOptions): Promise<RequestAudioStreamResult>;

  requestAudioCallback(options: RequestAudioCallbackOptions): RequestAudioResult;

  updateAudioStream(id: RequestAudioResult['id'], options: Partial<Pick<RequestAudioOptions, 'buffering' | 'gain'>>): boolean;

  deleteAudioStream(id: number): void;

  static getMetadata(path: string): Metadata | undefined;

  static getCoverAndLyrics(path: string): CoverAndLyrics;

  static isTrackLoadable(track: TrackDescriptor<any>): boolean;
}

declare const audioFormats = ['Int16LE', 'Int16BE', 'FloatLE', 'FloatBE'] as const;

export type AudioFormat = typeof audioFormats[number];

export type RequestAudioOptions = {
  sampleRate?: number;
  /**
   * Maximun frames the internal buffer can hold, increase this value helps reduce stuttering in some situations
   *
   * @default 250ms (sampleRate * 0.25)
   */
  bufferSize?: number;

  /**
   * Number of frames to buffer before returning the buffered frames back to NodeJS stream
   *
   * Reducing this value will cause the stream to pump faster
   *
   * Setting this value to 0 may cause the underlying stream to return empty buffers
   * which cause NodeJS to utilize more CPU cycles while waiting for data
   *
   * @default 10ms (sampleRate * 0.01)
   */
  buffering?: number;

  /**
   * Number of frames to pre-fill into the stream
   */
  preFill?: number;

  format: AudioFormat;

  /**
   * Output gain, a floating point number range from 0-1
   *
   * @default 1.0 (0dBFS)
   */
  gain?: number;
}

export type RequestAudioCallbackOptions = RequestAudioOptions & {
  callback: (buffer: Buffer) => Promise<any> | any;
}

export type RequestAudioResult = {
  readonly id: number;
  readonly channels: number;
  readonly originalSampleRate: number;
  readonly sampleRate: number;
  readonly bitPerSample: number;
}

export type RequestAudioStreamResult = RequestAudioResult & {
  readonly stream: Readable;
}

export type AudioDeviceDescriptor = {
  type: string;
  device: string;
}

export type AudioDeviceTypeInfo = {
  type: string;
  isCurrent: boolean;
  devices: string[];
  defaultDevice: string;
  currentDevice?: string;
}

export type Metadata = {
  title?: string;
  artist?: string;
  album?: string;
  isrc?: string;
  albumArtist?: string;
  originalArtist?: string;
  bitrate?: number;
  sampleRate?: number;
  duration?: number;
  trackGain?: number;
  bpm?: number;
}

export type CoverAndLyrics = {
  cover: Buffer;
  coverMimeType: string;
  lyrics: string;
}

export type DeckPositions = {
  current: number;

  duration: number;

  /**
   * First audible position
   */
  first: number;

  /**
   * Last audible position
   */
  last: number;
}
