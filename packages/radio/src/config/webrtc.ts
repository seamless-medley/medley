import { z } from "zod";

export const ListenInfo = z.object({
  protocol: z.enum(['tcp', 'udp']),
  ip: z.ipv4(),
  port: z.number().min(1).max(65535).optional(),
  announcedIp: z.ipv4().optional()
}).superRefine(({ announcedIp, ip }, ctx) => {
  if (!announcedIp && (ip === '0.0.0.0') || (ip === '::')) {
    ctx.addIssue({
      code: 'custom',
      message: '`announcedIp` is required when `ip` is set to `0.0.0.0` or `::`'
    })
  }
});

export type ListenInfo = z.infer<typeof ListenInfo>;

export const WebRtcConfig = z.object({
  listens: z.array(ListenInfo),
  bitrate: z.number().positive().max(256).optional().default(256)
});

export type WebRtcConfig = z.infer<typeof WebRtcConfig>;
