import { z } from "zod";

export const ServerConfig = z.object({
  port: z.number().min(1).max(65535).optional(),
  address: z.string().ip().optional()
});

export type ServerConfig = z.infer<typeof ServerConfig>;
