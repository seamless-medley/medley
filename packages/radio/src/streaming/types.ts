import { AudioFormat, audioFormats, RequestAudioOptions, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { createFFmpegOverseer, FFmpegChildProcess, FFMpegLine, FFmpegOverseer, FFmpegOverseerOptions, ProgressValue } from "./ffmpeg";
import { Router } from "express";

const audioTypes = ['s16le', 's16be', 'f32le', 'f32be'];
type AudioTypes = typeof audioTypes[number];

export const audioFormatToAudioType = (format: AudioFormat): AudioTypes => audioTypes[audioFormats.indexOf(format)];

export type AdapterOptions<F extends string> = {
  sampleFormat?: AudioFormat;
  sampleRate?: number;
  bitrate?: number;
  outputFormat?: F;
  fx?: RequestAudioOptions['fx'];
}

export interface StreamingAdapter<S> {
  get error(): Error | undefined;
  get initialized(): boolean;
  get statistics(): S;
  get httpRouter(): Router | undefined;
  init(): Promise<void>;
  start(): void;
  stop(): void;
  destroy(): void;
}

export abstract class BaseStreamingAdapter<S> implements StreamingAdapter<S> {
  protected audioRequest?: RequestAudioStreamResult;

  constructor(readonly station: Station) {

  }

  abstract get initialized(): boolean;

  abstract get error(): Error | undefined;

  abstract get infoLine(): string | undefined;

  abstract get statistics(): S;

  get httpRouter(): StreamingAdapter<any>['httpRouter'] {
    return undefined;
  }

  abstract init(): Promise<void>;

  abstract start(): void;

  abstract stop(): void;

  abstract destroy(): void;
}

export abstract class FFMpegAdapter<S = ProgressValue> extends BaseStreamingAdapter<S> {
  protected overseer?: FFmpegOverseer;

  constructor(station: Station, readonly binPath?: string) {
    super(station);
  }

  async init() {
    this.overseer = await createFFmpegOverseer(
      {
        args: await this.getArgs(),
        exePath: this.binPath,
        respawnDelay: this.getRespawnDelay(),
        beforeSpawn: () => this.beforeSpawn(),
        afterSpawn: process => this.afterSpawn(process),
        started: () => this.started(),
        log: line => this.log(line)
      }
    );
  }

  async destroy() {
    this.stop();
  }

  protected async getArgs(): Promise<string[]> {
    return []
  }

  protected getRespawnDelay(): FFmpegOverseerOptions['respawnDelay'] | undefined {
    return;
  }

  protected async beforeSpawn(): Promise<boolean | undefined> {
    return true;
  }

  protected async afterSpawn(process: FFmpegChildProcess): Promise<void> {

  }

  protected started(): any {

  }

  protected log(line: FFMpegLine): any {

  }

  start() {

  }

  stop() {
    this.overseer?.stop();
  }
}
