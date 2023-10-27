import type { RemoteTypes } from "../remotes";
import type { RTCTransponder } from "../remotes/rtc/transponder";
import type { Remotable } from "../socket/types";
import { WebSocketAudioTransport } from "./audio/transports/ws/transport";
import { WebRTCAudioTransport } from "./audio/transports/webrtc/transport";
import { Client } from "./client";
import { StubRTCTransponder } from "./stubs/rtc/transponder";

export class MedleyClient extends Client<RemoteTypes> {
  #audioContext = new AudioContext({ latencyHint: 'playback' });

  #audioSocketPipeline: WebSocketAudioTransport;

  #rtcClient?: WebRTCAudioTransport;

  #transponder?: Remotable<RTCTransponder>;

  #playingStationId?: string;

  constructor() {
    super();

    this.#audioSocketPipeline = new WebSocketAudioTransport(this.#audioContext)
      .on('audioExtra', e => this.emit('audioExtra', e));
  }

  protected override async handleSocketConnect() {
    super.handleSocketConnect();
    // TODO: try with transponder first
    // this.#transponder = await this.surrogateOf(StubRTCTransponder, 'transponder', '~').catch(() => undefined);

    // if (this.#transponder) {
    //   this.#rtcClient = new RTCAudioClient(this.#transponder, this.#audioContext)
    //     .on('audioExtra', e => this.emit('audioExtra', e));
    // }
    // TODO: and fallback to audio socket
    this.connectAudioSocket();
  }

  private async connectAudioSocket() {
    return this.#audioSocketPipeline.connect(this.socket.id);
  }

  async playAudio(stationId: string) {
    await this.connectAudioSocket();
    await this.#audioSocketPipeline.play(stationId);

    // console.log(this.#rtcClient);
    // this.#rtcClient?.play(stationId).then((result) => {
    //   console.log('rtc play', result);
    // })

    this.#playingStationId = stationId;
  }

  get playingStationId() {
    return this.#playingStationId;
  }
}
