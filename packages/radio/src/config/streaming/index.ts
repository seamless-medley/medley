import { z } from "zod";
import { ShoutConfig } from "./shout";
import { IcyConfig } from "./icy";
import { UDPConfig } from "./udp";

export const StreamingConfig = z.discriminatedUnion('type', [
  ShoutConfig,
  IcyConfig,
  UDPConfig
]);

export type StreamingConfig = z.infer<typeof StreamingConfig>;

export const StreamingConfigs = z.array(StreamingConfig);

export type StreamingConfigs = z.infer<typeof StreamingConfigs>;
