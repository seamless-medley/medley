import { type EventEmitter } from "eventemitter3";
import { type AudioTransportExtra } from "../../audio/types";

export type AudioTransportState = 'new' | 'failed' | 'ready';

export type AudioTransportEvents = {
  stateChanged(newState: AudioTransportState): void;
  audioExtra(extra: AudioTransportExtra): void;
}

export type AudioTransportPlayResult = boolean | 'transport_failed' | 'media_failed';

export interface IAudioTransport extends EventEmitter<AudioTransportEvents> {
  get state(): AudioTransportState;
  prepareAudioContext(): Promise<void>;
  dispose(): Promise<void>;
  play(stationId: string, options?: any): Promise<AudioTransportPlayResult>;
  stop(): Promise<void>;
  set transmissionLatency(value: number);
  get latency(): number;
}

export async function waitForAudioTransportState(transport: IAudioTransport, states: AudioTransportState[], timeout = 2000): Promise<AudioTransportState | undefined> {
  if (states.includes(transport.state)) {
    return transport.state;
  }

  return new Promise((resolve) => {
    const abortTimer = setTimeout(() => resolve(undefined), timeout);

    const handler = (newState: AudioTransportState) => {
      if (states.includes(newState)) {
        clearTimeout(abortTimer);

        transport.off('stateChanged', handler);
        resolve(newState);
      }
    };

    transport.on('stateChanged', handler);
  });
}
