import { AudioFormat, audioFormats, RequestAudioStreamResult } from "@seamless-medley/core";
import { Readable } from "stream";

const audioTypes = ['s16le', 's16be', 'f32le', 'f32be'];
type AudioTypes = typeof audioTypes[number];

export const audioFormatToAudioType = (format: AudioFormat): AudioTypes | undefined => audioTypes[audioFormats.indexOf(format)];

export const mimeTypes = {
  mp3: 'audio/mpeg',
  adts: 'audio/aac'
}

export type AdapterOptions<F extends string> = {
  sampleFormat?: AudioFormat;
  sampleRate?: number;
  bitrate?: number;
  outputFormat?: F;
}

export type Adapter = {
  audioRequest: RequestAudioStreamResult;
  outlet: Readable;
  stop: () => void;
}
