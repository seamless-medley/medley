import { z } from "zod";

export const ListenInfo = z.object({
  protocol: z.enum(['tcp', 'udp']),
  ip: z.ipv4(),
  port: z.number().min(1).max(65535).optional(),
  announcedIp: z.ipv4().optional()
});

export type ListenInfo = z.infer<typeof ListenInfo>;

export const WebRtcConfig = z.object({
  listens: z.array(ListenInfo),
  bitrate: z.number().positive().max(256).optional().default(256)
});

export type WebRtcConfig = z.infer<typeof WebRtcConfig>;
