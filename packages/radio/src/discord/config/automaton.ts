import { z } from "zod";
import { creatorNames } from "../trackmessage/creator";

export const TrackMessageConfig = z.object({
  type: z.enum(creatorNames).optional(),
  max: z.number().nonnegative().optional(),
  channel: z.string().optional()
});

export const GuildSpecificConfig = z.object({
  autotune: z.string().nonempty().optional(),
  autojoin: z.string().nonempty().optional(),
  trackMessage: TrackMessageConfig.optional()
}).strict();

export const AutomatonConfig = z.object({
  clientId: z.string().nonempty(),
  botToken: z.string().nonempty(),
  baseCommand: z.string().optional(),
  owners: z.string().array().nonempty().optional(),
  stations: z.string().array().optional(),
  guilds: z.record(z.string(), GuildSpecificConfig).optional()
}).strict();

export type AutomatonConfig = z.infer<typeof AutomatonConfig>;

