// This module works in Node env only

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker, MessageChannel } from "node:worker_threads";

// type Loader = {
//   new(options?: Partial<OpusOptions>): Opus;
//   load: () => boolean;
// }

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
});

type NativeInterface = {
  encode(audio: Buffer, frameSize: number): Promise<Buffer>;
  getBitrate(): number;
  setBitrate(value: number): void;
}

type OpusPrivate = {
  init(options: OpusOptions): Promise<void>;
}

export abstract class Opus<Intf extends NativeInterface = any> {
  protected native!: Intf;

  async encode(audio: Buffer, frameSize: number): Promise<Buffer> {
    return this.native.encode(audio, frameSize);
  }

  protected async init(options: OpusOptions): Promise<void> {
    this.bitrate = options.bitrate;
    this.errorCorrection = options.errorCorrection;
    this.packetLossPercentage = options.packetLossPercentage;
  }

  protected abstract ctl(c: number, value: number): any;

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

  static async create(options?: Partial<OpusOptions>): Promise<Opus> {
    for (const Ctor of [DiscordOpus, OpusScript]) {
      if (await Ctor.load()) {
        const inst = new Ctor();
        await (inst as unknown as OpusPrivate).init(makeOpusOptions(options));
        return inst;
      }
    }

    throw new ReferenceError('Could not find Opus native module');
  }
}

type OpusScriptInterface = NativeInterface & {
  encoderCTL(c: number, value: number): any;
}

class OpusScript extends Opus<OpusScriptInterface> {
  constructor() {
    super();
    this.native = new OpusScript.#Opus(48000, 2, OpusScript.#Opus.Application.AUDIO);
  }

  static #Opus: any;

  static async load() {
    if (this.#Opus) return true;

    try {
      this.#Opus = require('opusscript');
      return true;
    }
    catch {
      return false;
    }
  }

  #bitrate = 128_000;

  protected override ctl(c: number, value: number): any {
    return this.native.encoderCTL(c, value);
  }

  get bitrate() {
    return this.#bitrate;
  }

  set bitrate(value: number) {
    this.#bitrate = value;
    this.ctl(4002, value);
  }

}

type DiscordOpusInterface = NativeInterface & {
  applyEncoderCTL(c: number, value: number): any;
}

class DiscordOpus extends Opus<DiscordOpusInterface> {
  constructor() {
    super();
    this.native = new DiscordOpus.#OpusEncoder(48000, 2);
  }

  static #OpusEncoder: any;

  static async load() {
    if (this.#OpusEncoder) return true;

    try {
      this.#OpusEncoder = require('@discordjs/opus').OpusEncoder;
      return true;
    }
    catch {
      return false;
    }
  }

  protected override ctl(c: number, value: number): any {
    this.native.applyEncoderCTL(c, value);
  }
}
