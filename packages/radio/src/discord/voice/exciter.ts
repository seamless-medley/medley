import { pipeline, Readable } from "stream";
import type { RequestAudioStreamResult } from "@seamless-medley/core";
import { createAudioResource, StreamType } from "@discordjs/voice";
import { type OpusOptions } from "../../audio/codecs/opus/loader";
import { OpusPacketEncoder } from "../../audio/codecs/opus/stream";
import { noop } from "lodash";

export type ExciterOptions = Partial<OpusOptions> & {
  source: RequestAudioStreamResult;
}

export const createExciter = ({ source, ...options }: ExciterOptions) => createAudioResource(
  pipeline([source.stream, new OpusPacketEncoder(options)], noop) as unknown as Readable,
  {
    inputType: StreamType.Opus,
    metadata: source
  }
);

// This uses prism-media directly
// export const createExciter = (source: RequestAudioStreamResult) => createAudioResource(
//   source.stream,
//   {
//     inputType: StreamType.Raw,
//     metadata: source
//   }
// );
