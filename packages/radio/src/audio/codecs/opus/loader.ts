// This module works in Node env only

type Loader = {
  new(options?: Partial<OpusOptions>): Opus;
  load: () => boolean;
}

export type OpusOptions = {
  /**
   * Bitrate in bps
   */
  bitrate: number;
  errorCorrection: boolean;
  packetLossPercentage: number;
}

const makeOpusOptions = (options?: Partial<OpusOptions>): OpusOptions => ({
  bitrate: options?.bitrate || 128_000,
  errorCorrection: options?.errorCorrection ?? false,
  packetLossPercentage: options?.packetLossPercentage ?? 0
})

export abstract class Opus {
  protected native: any = undefined;

  encode(audio: Buffer, frameSize: number): Buffer {
    return this.native.encode(audio, frameSize);
  }

  protected init(options: OpusOptions): void {
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

  static create(options?: Partial<OpusOptions>): Opus {
    const Ctor = [DiscordOpus, OpusScript].find(c => c.load()) as Loader | undefined;

    if (!Ctor) {
      throw new ReferenceError('Could not find Opus native module');
    }

    return new Ctor(options);
  }
}

export class OpusScript extends Opus {
  constructor(options?: Partial<OpusOptions>) {
    super();
    this.native = new OpusScript.Opus(48000, 2, OpusScript.Opus.Application.AUDIO);
    this.init(makeOpusOptions(options));
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

export class DiscordOpus extends Opus {
  constructor(options?: Partial<OpusOptions>) {
    super();
    this.native = new DiscordOpus.OpusEncoder(48000, 2);
    this.init(makeOpusOptions(options));
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
