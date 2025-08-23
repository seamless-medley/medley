import { z } from "zod";
import { StreamingConfigTrait } from "./adapter";

export const AdtsOptions = z.object({
  codec: z.literal('adts'),
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

const IcyFormat = z.discriminatedUnion('codec', [
  AdtsOptions,
  Mp3Options
]);

export const IcyConfig = StreamingConfigTrait.extend({
  type: z.literal('icy'),
  format: IcyFormat,
  mountpoint: z.string().regex(/^\/[^\/\s]+$/, { error: issue => `Invalid mountpoint '${issue.input}': must be in '/path' format` }),
  metadataInterval: z.number().int().optional()
})
