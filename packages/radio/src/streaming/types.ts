import { AudioFormat, audioFormats, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { Readable } from "stream";
import { createFFmpegOverseer, FFmpegChildProcess, FFMpegLine, FFmpegOverseer, FFmpegOverseerOptions, FFMpegOverseerStartupError } from "./ffmpeg";

const audioTypes = ['s16le', 's16be', 'f32le', 'f32be'];
type AudioTypes = typeof audioTypes[number];

export const audioFormatToAudioType = (format: AudioFormat): AudioTypes => audioTypes[audioFormats.indexOf(format)];

export type AdapterOptions<F extends string> = {
  sampleFormat?: AudioFormat;
  sampleRate?: number;
  bitrate?: number;
  outputFormat?: F;
}

export interface Adapter {
  readonly audioRequest: RequestAudioStreamResult;
  stop(): void;
}

export abstract class BaseAdapter {
  constructor(readonly station: Station) {

  }

  abstract init(): Promise<void>;
}

export abstract class FFMpegAdapter extends BaseAdapter {
  protected overseer!: FFmpegOverseer;

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
        started: error => this.started(error),
        log: line => this.log(line)
      }
    )
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

  protected started(error?: FFMpegOverseerStartupError): any {

  }

  protected log(line: FFMpegLine): any {

  }

  stop() {

  }
}
