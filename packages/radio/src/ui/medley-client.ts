import { Device as MediaSoupDevice, type types } from 'mediasoup-client';
import type { RemoteTypes } from "../remotes";
import type { RTCTransponder } from "../remotes/rtc/transponder";
import type { Remotable } from "../socket/types";
import { WebSocketAudioTransport } from "./audio/transports/ws/transport";
import { WebRTCAudioTransport } from "./audio/transports/webrtc/transport";
import { Client } from "./client";
import { StubRTCTransponder } from "./stubs/rtc/transponder";
import { IAudioTransport } from "./audio/types";

export class MedleyClient extends Client<RemoteTypes> {
  #audioContext = new AudioContext({ latencyHint: 'playback' });

  #audioTransport?: IAudioTransport;

  #transponder?: Remotable<RTCTransponder>;

  #playingStationId?: string;

  protected override async handleSocketConnect() {
    super.handleSocketConnect();

    this.#transponder = await this.surrogateOf(StubRTCTransponder, 'transponder', '~').catch(() => undefined);

    if (this.#transponder) {
      const device = new MediaSoupDevice();
      await device.load({ routerRtpCapabilities: this.#transponder.caps() });

      if (device.loaded) {
        console.log('Using WebRTCAudioTransport');
        this.#audioTransport = new WebRTCAudioTransport(this.#transponder, device, this.#audioContext);
      }
    }

    if (!this.#audioTransport && window.crossOriginIsolated) {
      console.log('Using WebSocketAudioTransport');
      this.#audioTransport = new WebSocketAudioTransport(this.#audioContext);
    }

    if (!this.#audioTransport) {
      console.error('No audio transport');
    }

    this.#audioTransport?.on('audioExtra', e => this.emit('audioExtra', e));

    this.connectAudioSocket();
  }

  private async connectAudioSocket() {
    if (this.#audioTransport instanceof WebSocketAudioTransport) {
      return this.#audioTransport.connect(this.socket.id);
    }
  }

  get hasTransport() {
    return this.#audioTransport !== undefined;
  }

  async playAudio(stationId: string): Promise<boolean> {
    if (!this.#audioTransport) {
      return false;
    }

    await this.connectAudioSocket();
    await this.#audioTransport.play(stationId);

    this.#playingStationId = stationId;

    return true;
  }

  get playingStationId() {
    return this.#playingStationId;
  }
}
