import { z } from "zod";

export const WebRtcConfig = z.object({
  listens: z.array(
    z.object({
      protocol: z.enum(['tcp', 'udp']),
      ip: z.string().ip(),
      port: z.number().min(1).max(65535),
      announcedIp: z.string().ip().optional()
    })
  ),
  bitrate: z.number().positive().max(256).optional().default(256)
});

export type WebRtcConfig = z.infer<typeof WebRtcConfig>;
