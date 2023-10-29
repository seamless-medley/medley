import { Device as MediaSoupDevice } from 'mediasoup-client';
import type { RemoteTypes } from "../remotes";
import type { RTCTransponder } from "../remotes/rtc/transponder";
import type { Remotable } from "../socket/types";
import { WebSocketAudioTransport } from "./audio/transports/ws/transport";
import { WebRTCAudioTransport } from "./audio/transports/webrtc/transport";
import { Client } from "./client";
import { StubRTCTransponder } from "./stubs/rtc/transponder";
import { IAudioTransport, waitForAudioTransportState } from "./audio/transport";

export class MedleyClient extends Client<RemoteTypes> {
  #audioContext = new AudioContext({ latencyHint: 'playback' });

  #audioTransport?: IAudioTransport;

  #transponder?: Remotable<RTCTransponder>;

  #playingStationId?: string;

  #transportCreators: Array<() => IAudioTransport> = [];

  protected override async handleSocketConnect() {
    super.handleSocketConnect();

    this.#transponder = await this.surrogateOf(StubRTCTransponder, 'transponder', '~').catch(() => undefined);

    if (this.#transponder) {
      const device = new MediaSoupDevice();
      await device.load({ routerRtpCapabilities: this.#transponder.caps() });

      if (device.loaded) {
        this.#transportCreators.push(() => {
          console.log('Using WebRTCAudioTransport');
          return new WebRTCAudioTransport(this.#transponder!, device, this.#audioContext)
        });
      }
    }

    if (window.crossOriginIsolated) {
      this.#transportCreators.push(() => {
        console.log('Using WebSocketAudioTransport');
        return new WebSocketAudioTransport(this.#audioContext, this.socket.id);
      });
    }

    const transport = await this.#nextTransport();

    if (!transport) {
      console.error('No audio transport');
      return;
    }

    transport.prepareAudioContext();
  }

  async #nextTransport() {
    while (this.#transportCreators.length) {
      const transport = this.#transportCreators.shift()?.();

      if (!transport) {
        continue;
      }

      const ready = await waitForAudioTransportState(transport, ['ready', 'failed']) === 'ready';

      if (ready) {
        this.#audioTransport = transport;
        transport.on('audioExtra', e => this.emit('audioExtra', e));
        this.emit('audioTransport', transport);
        return transport;
      }
    }
  }

  get hasTransport() {
    return this.#audioTransport !== undefined;
  }

  async playAudio(stationId: string): Promise<boolean> {
    if (!this.#audioTransport) {
      return false;
    }

    await this.#audioTransport.prepareAudioContext();;

    const playResult = await this.#audioTransport.play(stationId);

    if (playResult === true) {
      this.#playingStationId = stationId;
      return true;
    }

    // something went wrong, try next transport
    if (typeof playResult !== 'boolean') {
      await this.#nextTransport();

      if (this.#audioTransport) {
        return this.playAudio(stationId);
      }
    }

    return false;
  }

  get playingStationId() {
    return this.#playingStationId;
  }
}
