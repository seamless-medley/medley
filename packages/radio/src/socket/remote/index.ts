import { $Exposing, Exposable } from "../expose";
import { MixinEventEmitterOf } from "../types";
import { Config } from "./config";
import { Station } from "./station";


export type Tick = {
  count: number;
  ϟtick(count: number): void;

  test(): void;
}

export class ExposedTick extends MixinEventEmitterOf<Tick>() implements Exposable<Tick> {
  [$Exposing] = true as const;

  count = 0;

  constructor() {
    super();

    setInterval(() => this.tick(), 10);
  }

  tick() {
    this.count++;
    this.emit('tick', this.count);
  }

  dispose() {

  }

  test() {

  }
}

export type {
  Config
}

export interface RemoteTypes {
  config: Config;
  tick: Tick;
  station: Station;
}

