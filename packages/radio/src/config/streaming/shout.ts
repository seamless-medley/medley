import { z } from "zod";
import { AacOptions, FlacOptions, HeAAcOptions, Mp3Options, OpusOptions, StreamingConfigTrait, VorbisOptions } from "./adapter";

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
  icecast: IcecastConfig,
  format: ShoutFormat
}).strict();
