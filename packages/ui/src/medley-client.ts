import { createNamedFunc } from '@seamless-medley/utils';
import { Device as MediaSoupDevice } from 'mediasoup-client';
import { clamp, noop } from 'lodash';
import { getLogger } from '@logtape/logtape';

import type {
  RemoteObjects,
  Station as RemoteStation, Global as RemoteGlobal,
  RTCTransponder,
  Remotable
} from "@seamless-medley/remote";

import { AudioTransportPlayResult, IAudioTransport, waitForAudioTransportState } from "./audio/transport";
import { WebSocketAudioTransport } from "./audio/transports/ws/transport";
import { WebRTCAudioTransport } from "./audio/transports/webrtc/transport";

import { Client } from "./client";
import { KaraokeFx } from './audio/fx/karaoke';

const logger = getLogger(['client', 'medley']);

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

  #karaokeFx: Promise<KaraokeFx | undefined>;

  #karaokeEnabled = false;

  #mediaSessionCover: string | undefined;

  constructor() {
    super();

    this.#output = new GainNode(this.#audioContext);
    this.#output.connect(this.#audioContext.destination);

    this.#karaokeFx = this.#prepareKaraoke();
    this.karaokeEnabled = false;

    this.volume = +(localStorage.getItem("volume") ?? 1.0);

    if (hasMediaSession()) {
      navigator.mediaSession.setActionHandler('play', noop);
      navigator.mediaSession.setActionHandler('pause', () => void this.stopAudio());
    }
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
    if (!await KaraokeFx.prepare(this.#audioContext)) {
      return;
    }

    return new KaraokeFx(this.#audioContext).connect(this.#output);
  }

  async #getOutput() {
    return (await this.#karaokeFx)?.input ?? this.#output;
  }

  protected override async handleSocketConnect() {
    await super.handleSocketConnect();

    this.#global = await this.surrogateOf('global', '$');

    await this.#audioTransport?.dispose();
    this.#audioTransport = undefined;

    this.#transportCreators = [];
    this.#transponder = undefined;

    this.#transponder = await this.surrogateOf('transponder', '~').catch((e) => {
      logger.error('Transponder {e}', {e});
      return undefined;
    });

    if (this.#transponder) {
      const rtcCaps = this.#transponder.rtcCaps();

      for (const [rtcId, caps] of rtcCaps) {
        this.#transportCreators.push(createNamedFunc(`create_webrtc_transport_${rtcId}`, async () => {
          logger.info('Using WebRTCAudioTransport {*}', { rtcId });

          const device = new MediaSoupDevice();
          await device.load({ routerRtpCapabilities: caps });

          return new WebRTCAudioTransport(rtcId, this.#transponder!, device, this.#audioContext, await this.#getOutput());
        }));
      }
    }

    // See: https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
    if (window.crossOriginIsolated) {
      this.#transportCreators.push(createNamedFunc('create_ws_transport', async () => {
        if (!this.socket.id) {
          return;
        }

        logger.info('Using WebSocketAudioTransport');
        return new WebSocketAudioTransport(this.socket.id, this.#audioContext, await this.#getOutput());
      }));
    }

    const transport = await this.#nextTransport();

    if (!transport) {
      logger.error('No audio transport');
      return;
    }

    transport.prepareAudioContext();

    if (this.#playingStationId) {
      this.playAudio(this.#playingStationId);
    }
  }

  async #nextTransport() {
    while (this.#transportCreators.length) {
      const creator = this.#transportCreators.shift();

      if (!creator) {
        continue;
      }

      const transport = await creator();

      if (!transport) {
        logger.warn('Could not create transport using creator: {creator}', { creator: creator.name });
        continue;
      }

      const state = await waitForAudioTransportState(transport, ['ready', 'rtc_failed']);

      if (!state) {
        logger.warn('Timeout waiting for transport to become ready: {transport}', { transport });
        continue;
      }

      if (state.type === 'rtc_failed') {
        logger.warn('Transport failed: {data}', { data: { transport, info: state.transportInfo } });
        continue;
      }

      if (state.type !== 'ready') {
        continue;
      }

      this.#audioTransport = transport;
      transport.on('audioExtra', e => this.emit('audioExtra', e));
      this.emit('audioTransport', transport);
      return transport;
    }
  }

  get hasTransport() {
    return this.#audioTransport !== undefined;
  }

  async playAudio(stationId: string): Promise<AudioTransportPlayResult> {
    if (!this.#audioTransport) {
      throw new Error('No audio transport');
    }

    await this.#audioTransport.prepareAudioContext();

    const playResult = await this.#audioTransport.play(stationId);

    if (playResult === true) {
      if (hasMediaSession()) {
        navigator.mediaSession.playbackState = 'playing';
      }

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

    return playResult;
  }

  stopAudio() {
    navigator.mediaSession.playbackState = 'none';
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
    this.#station?.off('deckActive', this.#onDeckActive);

    if (!this.#playingStationId) {
      return;
    }

    this.#station = await this.surrogateOf('station', this.#playingStationId).catch(() => undefined);
    this.#station?.on('deckStarted', this.#onDeckStarted);
    this.#station?.on('deckActive', this.#onDeckActive);

    const activeDeck = this.#station?.activeDeck();
    if (typeof activeDeck === 'number') {
      this.#updateMediaSession(activeDeck);
    }
  }

  #onDeckStarted: RemoteStation['ϟdeckStarted'] = (deckIndex, { kind }) => {
    if (kind === 'insert') {
      this.#temporarilyDisableKaraoke();
      return;
    }

    this.#restoreKaraoke();
  }

  #onDeckActive: RemoteStation['ϟdeckActive'] = (deckIndex) => {
    this.#updateMediaSession(deckIndex);
  }

  async #updateMediaSession(deckIndex: number) {
    if (!hasMediaSession()) {
      return;
    }

    if (!this.#station) {
      return;
    }

    const deckInfo = await this.#station.getDeckInfo(deckIndex);
    const { title, artist, album } = deckInfo.trackPlay?.track?.extra?.tags ?? {};
    const { cover, coverMimeType } = deckInfo.trackPlay?.track?.extra?.coverAndLyrics ?? {};

    if (this.#mediaSessionCover) {
      this.releaseURLForBuffer(this.#mediaSessionCover);
      this.#mediaSessionCover = undefined;
    }

    if (deckInfo.trackPlay && cover && coverMimeType) {
      this.#mediaSessionCover = this.getURLForBuffer(deckInfo.trackPlay.uuid, { buffer: cover, type: coverMimeType });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: this.#mediaSessionCover
        ? [{
          src: this.#mediaSessionCover,
          type: coverMimeType
        }]
        : undefined
    });

    navigator.mediaSession.setPositionState?.({
      duration: Infinity,
      playbackRate: 1,
      position: 0
    });
  }

  async #temporarilyDisableKaraoke() {
    const fx = await this.#karaokeFx;
    fx?.set('mix', 0, 0.5);
  }

  async #restoreKaraoke() {
    const fx = await this.#karaokeFx;

    if (!fx) {
      return;
    }

    if (this.#karaokeEnabled) {
      fx.bypass = false;
    }

    fx.set('mix', this.#karaokeEnabled ? 0.70 : 0, 0.5);
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

  #urlForBufferMap = new Map<string, URLForBufferInfo>;
  #urlForBufferUrlMap = new Map<string, URLForBufferInfo>;

  getURLForBuffer(id: string, { buffer, type }: { buffer: Buffer<ArrayBufferLike> | undefined, type?: string }) {
    if (this.#urlForBufferMap.has(id)) {
      const info = this.#urlForBufferMap.get(id)!;
      info.refCount++;
      return info.url;
    }

    const url = URL.createObjectURL(new Blob([buffer as BufferSource], { type }));

    const info = {
      id,
      url,
      refCount: 1
    }

    this.#urlForBufferMap.set(id, info);
    this.#urlForBufferUrlMap.set(url, info)

    return url;
  }

  releaseURLForBuffer(url: string) {
    const info = this.#urlForBufferUrlMap.get(url);
    if (!info) {
      return;
    }

    if (--info.refCount <= 0) {
      this.#urlForBufferMap.delete(info.id);
      this.#urlForBufferUrlMap.delete(url);
      URL.revokeObjectURL(url);
    }
  }
}

type URLForBufferInfo = {
  id: string;
  url: string;
  refCount: number;
}

function hasMediaSession() {
  return 'mediaSession' in navigator;
}
