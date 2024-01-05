import { z } from "zod";
import { ShoutConfig } from "./shout";
import { IcyConfig } from "./icy";

export const StreamingConfig = z.discriminatedUnion('type', [
  ShoutConfig,
  IcyConfig
]);

export type StreamingConfig = z.infer<typeof StreamingConfig>;

export const StreamingConfigs = z.array(StreamingConfig);

export type StreamingConfigs = z.infer<typeof StreamingConfigs>;
