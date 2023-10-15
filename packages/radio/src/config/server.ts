import { z } from "zod";

export const ServerConfig = z.object({
  port: z.number().min(1).max(65535).optional()
});

export type ServerConfig = z.infer<typeof ServerConfig>;
