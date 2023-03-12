import { Station } from "@seamless-medley/core";
import { Exciter, IExciter } from "../../../audio/exciter";

export class DiscordAudioPlayer extends Exciter implements IExciter {
  constructor(station: Station, initialGain: number, bitrate = 256_000) {
    super(
      station,
      {
        bufferSize: 48000 * 2.5, // This should be large enough to hold PCM data while waiting for node stream to comsume
        buffering: 960, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
        preFill: 48000 * 0.5, // Pre-fill the stream with at least 500ms of audio, to reduce stuttering while encoding to Opus
        // discord voice only accept 48KHz sample rate, 16 bit per sample
        sampleRate: 48000,
        format: 'Int16LE',
        gain: initialGain
      },
      { bitrate }
    );
  }
}
