import { z } from "zod";
import { StreamingConfigTrait } from "./adapter";

export const PCMCodecConfig = z.object({
  type: z.literal('pcm'),
  sampleRate: z.int().min(8000).max(48000),
  sampleFormat: z.union([
    z.literal('Int16LE'),
    z.literal('Int16BE'),
    z.literal('FloatLE'),
    z.literal('FloatBE')
  ])
})

export const CodecConfig = z.discriminatedUnion('type', [
  PCMCodecConfig
])

export const UDPConfig = StreamingConfigTrait.extend({
  type: z.literal('udp'),
  address: z.union([z.hostname(), z.ipv4()]),
  port: z.int().min(1).max(65535),
  frameSize: z.int().min(1024),
  codec: CodecConfig
}).strict();
