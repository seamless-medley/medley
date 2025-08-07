import { z } from "zod";

export const ServerConfig = z.object({
  port: z.number().min(1).max(65535).optional(),
  address: z.ipv4().optional(),
  audioBitrate: z.number().positive().max(256).optional().default(256)
});

export type ServerConfig = z.infer<typeof ServerConfig>;
