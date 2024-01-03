import { z } from "zod";
import { ShoutConfig } from "./shout";

export const StreamingConfig = z.discriminatedUnion('type', [
  ShoutConfig
]);

export type StreamingConfig = z.infer<typeof StreamingConfig>;

export const StreamingConfigs = z.array(StreamingConfig);

export type StreamingConfigs = z.infer<typeof StreamingConfigs>;
