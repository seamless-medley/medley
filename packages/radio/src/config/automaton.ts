import { z } from "zod";
import { creatorNames } from "../discord/trackmessage/creator";

export const TrackMessageConfig = z.object({
  type: z.enum(creatorNames).optional(),
  max: z.number().nonnegative().optional(),
  channel: z.string().optional(),
  retainOnReaction: z.boolean().optional(),
  always: z.boolean().optional()
}).strict();

export const GuildSpecificConfig = z.object({
  autotune: z.string().min(1).optional(),
  autojoin: z.string().min(1).optional(),
  trackMessage: TrackMessageConfig.optional(),
  bitrate: z.number().positive().max(256).optional().default(256),
  gain: z.number().min(0).max(1).optional().default(1.0)
}).strict();

export const AutomatonConfig = z.object({
  clientId: z.string().min(1),
  botToken: z.string().min(1),
  baseCommand: z.string().optional(),
  owners: z.string().array().nonempty().optional(),
  stations: z.string().array().optional(),
  guilds: z.record(z.string(), GuildSpecificConfig).optional()
}).strict();

export type AutomatonConfig = z.infer<typeof AutomatonConfig>;

