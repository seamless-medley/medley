import { type EventEmitter } from "eventemitter3";
import { type AudioTransportExtra } from "../../audio/types";

export type AudioTransportEvents = {
  audioExtra(extra: AudioTransportExtra): void;
}

export interface IAudioTransport extends EventEmitter<AudioTransportEvents> {
  get ready(): boolean;
  play(stationId: string, options?: any): Promise<boolean>;
}
