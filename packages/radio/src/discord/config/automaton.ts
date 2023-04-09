import { z } from "zod";

export const AutomatonConfig = z.object({
  clientId: z.string().nonempty(),
  botToken: z.string().nonempty(),
  baseCommand: z.string().optional(),
  owners: z.string().nonempty().array().optional(),
  maxTrackMessages: z.number().nonnegative().optional()
}).strict();

