import { Device as MediaSoupDevice } from 'mediasoup-client';
import type { RemoteTypes } from "../remotes";
import type { RTCTransponder } from "../remotes/rtc/transponder";
import type { Remotable } from "../socket";
import { WebSocketAudioTransport } from "./audio/transports/ws/transport";
import { WebRTCAudioTransport } from "./audio/transports/webrtc/transport";
import { Client } from "./client";
import { StubRTCTransponder } from "./stubs/rtc/transponder";
import { IAudioTransport, waitForAudioTransportState } from "./audio/transport";
import { KaraokeFx } from './audio/fx/karaoke';
import { StubStation } from './stubs/core/station';
import { Station as RemoteStation } from '../remotes/core/station';
import { createNamedFunc } from '@seamless-medley/utils';

  #audioContext = new AudioContext({ latencyHint: 'playback' });
type MedleyClientEvents = {
  audioTransport(transport: IAudioTransport): void;
  playingStation(id?: string): void;
}

export class MedleyClient extends Client<RemoteTypes, MedleyClientEvents> {
  #audioTransport?: IAudioTransport;

  #transponder?: Remotable<RTCTransponder>;

  #playingStationId?: string;

  #transportCreators: Array<() => Promise<IAudioTransport | undefined>> = [];

  #station?: Remotable<RemoteStation>;

  #karaokeFx: Promise<KaraokeFx>;

  #karaokeEnabled = false;

  constructor() {
    super();

    this.#karaokeFx = this.#prepareKaraoke();
    this.karaokeEnabled = false;
  }

  override set latency(ms: number) {
    if (this.#audioTransport) {
      this.#audioTransport.transmissionLatency = ms / 1000;
    }
  }

  async #prepareKaraoke() {
    await KaraokeFx.prepare(this.#audioContext);
    return new KaraokeFx(this.#audioContext).connect(this.#audioContext.destination);
  }

  protected override async handleSocketConnect() {
    await super.handleSocketConnect();

    this.#transportCreators = [];
    this.#transponder = undefined;

    this.#transponder = await this.surrogateOf(StubRTCTransponder, 'transponder', '~').catch(() => undefined);

    if (this.#transponder) {
      const device = new MediaSoupDevice();
      await device.load({ routerRtpCapabilities: this.#transponder.caps() });

      if (device.loaded) {
        this.#transportCreators.push(createNamedFunc('create_webrtc', async () => {
          console.log('Using WebRTCAudioTransport');
          return new WebRTCAudioTransport(this.#transponder!, device, this.#audioContext, (await this.#karaokeFx).input);
        }));
      }
    }

    if (window.crossOriginIsolated) {
      this.#transportCreators.push(createNamedFunc('create_ws', async () => {
        if (!this.socket.id) {
          return;
        }

        console.log('Using WebSocketAudioTransport');
        return new WebSocketAudioTransport(this.socket.id, this.#audioContext, (await this.#karaokeFx).input);
      }));
    }

    const transport = await this.#nextTransport();

    if (!transport) {
      console.error('No audio transport');
      return;
    }

    transport.prepareAudioContext();
  }

  protected override async startSession() {
    if (!this.authData) {
      console.log('[test] Login as admin');
      // this.authenticate('admin', 'admin'); // FIXME: this should be called on login action
    }

    await super.startSession();
  }

  async #nextTransport() {
    while (this.#transportCreators.length) {
      const transport = await this.#transportCreators.shift()?.();

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
      this.#monitorStation();
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

  async #monitorStation() {
    this.#station?.off('deckStarted', this.#onDeckStarted);

    if (!this.#playingStationId) {
      return;
    }

    this.#station = await this.surrogateOf(StubStation, 'station', this.#playingStationId).catch(() => undefined);
    this.#station?.on('deckStarted', this.#onDeckStarted);
  }

  #onDeckStarted: RemoteStation['ϟdeckStarted'] = (deckIndex, { kind }) => {
    if (kind === 'insert') {
      this.#temporarilyDisableKaraoke();
      return;
    }

    this.#restoreKaraoke();
  }

  async #temporarilyDisableKaraoke() {
    const fx = await this.#karaokeFx;
    fx.set('mix', 0, 0.5);
  }

  async #restoreKaraoke() {
    const fx = await this.#karaokeFx;

    if (this.#karaokeEnabled) {
      fx.bypass = false;
    }

    fx.set('mix', this.#karaokeEnabled ? 0.8 : 0, 0.5);
  }

  get karaokeEnabled() {
    return this.#karaokeEnabled;
  }

  set karaokeEnabled(v) {
    if (this.karaokeEnabled === v) {
      return;
    }

    this.#karaokeEnabled = v;
    this.#restoreKaraoke();
  }

}
