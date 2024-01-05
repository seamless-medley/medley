import { z } from "zod";
import { StreamingConfigTrait } from "./adapter";

export const AacOptions = z.object({
  codec: z.literal('aac'),
  sampleRate: z.union([
    z.literal(11025),
    z.literal(12000),
    z.literal(16000),
    z.literal(22050),
    z.literal(24000),
    z.literal(32000),
    z.literal(44100),
    z.literal(48000)
  ]),
  bitrate: z.number().int().min(16).max(320)
}).strict();


export const HeAAcOptions = z.object({
  codec: z.literal('he-aac'),
  sampleRate: z.union([
    z.literal(11025),
    z.literal(12000),
    z.literal(16000),
    z.literal(22050),
    z.literal(24000),
    z.literal(32000),
    z.literal(44100),
    z.literal(48000)
  ]),
  bitrate: z.number().int().min(16).max(320)
}).strict();

export const VorbisOptions = z.object({
  codec: z.literal('vorbis'),
  sampleRate: z.union([
    z.literal(8000),
    z.literal(11025),
    z.literal(12000),
    z.literal(16000),
    z.literal(22050),
    z.literal(24000),
    z.literal(32000),
    z.literal(44100),
    z.literal(48000)
  ]),
  bitrate: z.number().int().min(8).max(320)
}).strict();

export const OpusOptions = z.object({
  codec: z.literal('opus'),
  sampleRate: z.union([
    z.literal(8000),
    z.literal(12000),
    z.literal(16000),
    z.literal(24000),
    z.literal(44100),
    z.literal(48000)
  ]),
  bitrate: z.number().int().min(8).max(320)
}).strict();

export const FlacOptions = z.object({
  codec: z.literal('flac'),
  sampleRate: z.number().int().min(8_000).max(192_000)
}).strict();

export const Mp3Options = z.object({
  codec: z.literal('mp3'),
  sampleRate: z.union([
    z.literal(8000),
    z.literal(11025),
    z.literal(12000),
    z.literal(16000),
    z.literal(22050),
    z.literal(24000),
    z.literal(32000),
    z.literal(44100),
    z.literal(48000)
  ]),
  bitrate: z.number().int().min(80).max(320)
}).strict();

const ShoutFormat = z.discriminatedUnion('codec', [
  AacOptions,
  HeAAcOptions,
  VorbisOptions,
  OpusOptions,
  FlacOptions,
  Mp3Options
]);

const IcecastConfig = z.object({
  host: z.string().ip().or(z.string().min(1)),
  port: z.number().min(1).max(65565),
  tls: z.boolean().optional(),
  mountpoint: z.string().startsWith('/').optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  public: z.boolean().optional()
}).strict();

export const ShoutConfig = StreamingConfigTrait.extend({
  type: z.literal('shout'),
  format: ShoutFormat,
  icecast: IcecastConfig,
}).strict();
