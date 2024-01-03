import { z } from 'zod';

export const AudioFormat = z.enum(['Int16LE', 'Int16BE', 'FloatLE', 'FloatBE']);

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

export const StreamingConfigTrait = z.object({
  station: z.string().min(1),
  fx: z.object({
    karaoke: z.object({
      enabled: z.boolean().optional(),
      dontTransit: z.boolean().optional(),
      mix: z.number().min(0).max(1).optional(),
      lowpassCutoff: z.number().int().min(10).max(20_000).optional(),
      lowpassQ: z.number().min(0.01).max(10.0).optional(),
      highpassCutoff: z.number().int().min(10).max(20_000).optional(),
      highpassQ: z.number().min(0.01).max(10.0).optional(),
    }).strict().optional()
  }).strict().optional()
}).strict();
