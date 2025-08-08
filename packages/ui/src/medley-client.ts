import { createNamedFunc } from '@seamless-medley/utils';
import { Device as MediaSoupDevice } from 'mediasoup-client';
import { clamp } from 'lodash';

import type {
  RemoteObjects,
  Station as RemoteStation, Global as RemoteGlobal,
  RTCTransponder,
  Remotable
} from "@seamless-medley/remote";

import { IAudioTransport, waitForAudioTransportState } from "./audio/transport";
import { WebSocketAudioTransport } from "./audio/transports/ws/transport";
import { WebRTCAudioTransport } from "./audio/transports/webrtc/transport";

import { Client } from "./client";
import { KaraokeFx } from './audio/fx/karaoke';

type MedleyClientEvents = {
  audioTransport(transport: IAudioTransport): void;
  playingStation(id?: string): void;
  volume(gain: number): void;
}

export class MedleyClient extends Client<RemoteObjects, MedleyClientEvents> {
  #volume = 1.0;

  #audioContext = new AudioContext({
    // This is crucial as we're using Opus which always decode to 48KHz PCM samples
    sampleRate: 48_000,
    latencyHint: 'playback'
  });

  #output: GainNode;

  #global?: Remotable<RemoteGlobal>;

  #audioTransport?: IAudioTransport;

  #transponder?: Remotable<RTCTransponder>;

  #playingStationId?: string;

  #transportCreators: Array<() => Promise<IAudioTransport | undefined>> = [];

  #station?: Remotable<RemoteStation>;

  #karaokeFx: Promise<KaraokeFx>;

  #karaokeEnabled = false;

  constructor() {
    super();

    this.#output = new GainNode(this.#audioContext);
    this.#output.connect(this.#audioContext.destination);

    this.#karaokeFx = this.#prepareKaraoke();
    this.karaokeEnabled = false;

    this.volume = +(localStorage.getItem("volume") ?? 1.0);
  }

  override set latency(seconds: number) {
    if (this.#audioTransport) {
      this.#audioTransport.transmissionLatency = seconds;
    }

    this._latency = seconds;
  }

  override get latency() {
    return this.#audioTransport?.latency ?? 0;
  }

  async #prepareKaraoke() {
    await KaraokeFx.prepare(this.#audioContext);
    return new KaraokeFx(this.#audioContext).connect(this.#output);
  }

  protected override async handleSocketConnect() {
    await super.handleSocketConnect();

    this.#global = await this.surrogateOf('global', '$');

    await this.#audioTransport?.dispose();
    this.#audioTransport = undefined;

    this.#transportCreators = [];
    this.#transponder = undefined;

    this.#transponder = await this.surrogateOf('transponder', '~').catch(() => undefined);

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

    // See: https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
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

    if (this.#playingStationId) {
      this.playAudio(this.#playingStationId);
    }
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

    await this.#audioTransport.prepareAudioContext();

    const playResult = await this.#audioTransport.play(stationId);

    if (playResult === true) {
      this.playingStationId = stationId;
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

  stopAudio() {
    this.playingStationId = undefined;
    this.#audioTransport?.stop();
  }

  get playingStationId() {
    return this.#playingStationId;
  }

  private set playingStationId(id) {
    this.#playingStationId = id;
    this.emit('playingStation', id);
  }

  async #monitorStation() {
    this.#station?.off('deckStarted', this.#onDeckStarted);

    if (!this.#playingStationId) {
      return;
    }

    this.#station = await this.surrogateOf('station', this.#playingStationId).catch(() => undefined);
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

  get volume() {
    return this.#volume;
  }

  set volume(gain: number) {
    gain = clamp(gain, 0, 1);
    this.#volume = gain;
    localStorage.setItem("volume", gain.toFixed(3));
    this.#output.gain.setTargetAtTime(gain, this.#audioContext.currentTime + 0.08, 0.08 * 0.33);
    this.emit('volume', gain);
  }

  async getStations(): Promise<string[]> {
    return this.#global?.getStations() ?? [];
  }

}
