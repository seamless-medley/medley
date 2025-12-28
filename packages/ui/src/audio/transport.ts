import type { EventEmitter } from "eventemitter3";
import type { AudioTransportExtra, ClientTransportInfo } from "@seamless-medley/remote";

export type AudioTransportStateNew = {
  type: 'new';
}

export type AudioTransportStateWebSocketFailed = {
  type: 'ws_failed';
}

export type AudioTransportStateRTCFailed = {
  type: 'rtc_failed';
  transportInfo: ClientTransportInfo;
}

export type AudioTransportStateReady = {
  type: 'ready';
}

export type AudioTransportState = AudioTransportStateNew | AudioTransportStateWebSocketFailed | AudioTransportStateRTCFailed | AudioTransportStateReady;

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
  set transmissionLatency(seconds: number);
  get latency(): number;
}

export async function waitForAudioTransportState(transport: IAudioTransport, states: AudioTransportState['type'][], timeout = 2000): Promise<AudioTransportState | undefined> {
  if (states.includes(transport.state.type)) {
    return transport.state;
  }

  return new Promise((resolve) => {
    const abortTimer = setTimeout(() => resolve(undefined), timeout);

    const handler = (newState: AudioTransportState) => {
      if (states.includes(newState.type)) {
        clearTimeout(abortTimer);

        transport.off('stateChanged', handler);
        resolve(newState);
      }
    };

    transport.on('stateChanged', handler);
  });
}
