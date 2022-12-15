type Loader = {
  new(options?: Partial<CodecOptions>): Codec;
  load: () => boolean;
}

export type CodecOptions = {
  /**
   * Bitrate in bps
   */
  bitrate: number;
  errorCorrection: boolean;
  packetLossPercentage: number;
}

const makeCodecOptions = (options?: Partial<CodecOptions>): CodecOptions => ({
  bitrate: options?.bitrate || 128_000,
  errorCorrection: options?.errorCorrection ?? false,
  packetLossPercentage: options?.packetLossPercentage ?? 0
})

export abstract class Codec {
  protected native: any = undefined;

  encode(audio: Buffer, frameSize: number): Buffer {
    return this.native.encode(audio, frameSize);
  }

  protected init(options: CodecOptions): void {
    this.bitrate = options.bitrate;
    this.errorCorrection = options.errorCorrection;
    this.packetLossPercentage = options.packetLossPercentage;
  }

  protected abstract ctl(c: number, value: number): void;

  get bitrate() {
    return this.native.getBitrate();
  }

  set bitrate(value: number) {
    this.native.setBitrate(value);
  }

  set errorCorrection(enabled: boolean) {
    this.ctl(4012, enabled ? 1 : 0);
  }

  set packetLossPercentage(percent: number) {
    this.ctl(4014, percent);
  }

  static create(options?: Partial<CodecOptions>): Codec {
    const Ctor = [DiscordOpusCodec, OpusScriptCodec].find(c => c.load()) as Loader | undefined;

    if (!Ctor) {
      throw new ReferenceError('Could not find Opus native module');
    }

    return new Ctor(options);
  }
}

export class OpusScriptCodec extends Codec {
  constructor(options?: Partial<CodecOptions>) {
    super();
    this.native = new OpusScriptCodec.Opus(48000, 2, OpusScriptCodec.Opus.Application.AUDIO);
    this.init(makeCodecOptions(options));
  }

  private static Opus: any;

  static load() {
    if (!this.Opus) return true;

    try {
      this.Opus = require('opusscript');
      return true;
    }
    catch {

    }
  }

  protected override ctl(c: number, value: number): void {
    this.native.encoderCTL(c, value);
  }
}

export class DiscordOpusCodec extends Codec {
  constructor(options?: Partial<CodecOptions>) {
    super();
    this.native = new DiscordOpusCodec.OpusEncoder(48000, 2);
    this.init(makeCodecOptions(options));
  }

  private static OpusEncoder: any;

  static load() {
    if (this.OpusEncoder) return true;

    try {
      this.OpusEncoder = require('@discordjs/opus').OpusEncoder;
      return true;
    }
    catch {

    }
  }

  protected override ctl(c: number, value: number): void {
    this.native.applyEncoderCTL(c, value);
  }
}
