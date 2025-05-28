import { Station } from "../../../core";
import { Exciter, ICarriableExciter } from "../../../audio/exciter";

export type DiscordAudioPlayerOptions = {
  gain?: number;
  bitrate?: number;
  backlog?: number;
}

export class DiscordAudioPlayer extends Exciter implements ICarriableExciter {

  constructor(station: Station, options: DiscordAudioPlayerOptions) {
    const { gain = 1.0, bitrate = 256_000, backlog = 12 } = options;
    super(
      station,
      {
        bufferSize: 48000 * 2.5, // This should be large enough to hold PCM data while waiting for node stream to comsume
        buffering: 960 * Math.max(1, backlog / 4),
        gain,
        // buffering: 0,
        // discord voice only accept 48KHz sample rate, 16 bit per sample
        sampleRate: 48000,
        format: 'Int16LE'
      },
      { bitrate, backlog }
    );
  }
}
