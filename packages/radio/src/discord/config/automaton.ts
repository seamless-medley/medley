import { z } from "zod";
import { creatorNames } from "../trackmessage/creator";

export const AutomatonConfig = z.object({
  clientId: z.string().nonempty(),
  botToken: z.string().nonempty(),
  baseCommand: z.string().optional(),
  owners: z.string().nonempty().array().optional(),
  trackMessage: z.object({
    type: z.enum(creatorNames).optional(),
    max: z.number().nonnegative().optional()
  }).optional()
}).strict();

