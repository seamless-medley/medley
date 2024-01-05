import { z } from 'zod';

export const AudioFormat = z.enum(['Int16LE', 'Int16BE', 'FloatLE', 'FloatBE']);

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
