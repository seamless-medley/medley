import { isString } from "lodash";
import { TypedEmitter } from "tiny-typed-emitter";
import WebSocket from 'ws';
import { VoiceOpcodes } from 'discord-api-types/voice/v4';
import { VoicePayload, VoiceClientPayload, VoiceServerPayload } from "./payload";

export interface WebSocketConnectionEvents {
  open(event: WebSocket.Event): void;
  close(event: WebSocket.CloseEvent): void;
  error(error: Error): void;
  payload(payload: VoiceServerPayload): void;
  ping(latency: number): void;
}

export class WebSocketConnection extends TypedEmitter<WebSocketConnectionEvents> {
  readonly #ws: WebSocket;

  #heartbeatTimer?: NodeJS.Timeout;

  #heartbeatSent = 0;
  #heartbeatAcked = 0;

  #missedHeartbeats = 0;

  #ping?: number;

  constructor(address: string) {
    super();

    const ws = new WebSocket(address);
    ws.onopen = this.#onOpen;
    ws.onclose = this.#onClose;
    ws.onmessage = this.#onMessage;
    ws.onerror = this.#onError;
    this.#ws = ws;
  }

  destroy() {
    try {
      this.heartbeatInterval = -1;
      this.#ws.close(1000);
    }
    catch (error) {
      this.emit('error', error as Error);
    }
  }

  #onOpen: WebSocket['onopen'] = (e) => {
    this.emit('open', e);
  }

  #onClose: WebSocket['onclose'] = (e) => {
    this.emit('close', e);
  }

  #onError: WebSocket['onerror'] = (e) => {
    this.emit('error', e.error);
  }

  #onMessage: WebSocket['onmessage'] = (e) => {
    if (!isString(e.data)) {
      return;
    }

    try {
			this.#handlePayload(JSON.parse(e.data) as VoicePayload);
		} catch (error) {
			this.emit('error', error as Error);
		}
  }

  #handlePayload(payload: VoicePayload) {
    if (payload.op === VoiceOpcodes.HeartbeatAck) {
      this.#updateHeartbeat();
    }

    this.emit('payload', payload as VoiceServerPayload);
  }

  #updateHeartbeat() {
    this.#heartbeatAcked = Date.now();
    this.#missedHeartbeats = 0;
    this.#ping = this.#heartbeatAcked - this.#heartbeatSent;
    this.emit('ping', this.#ping);
  }

  sendPayload(payload: VoiceClientPayload) {
    try {
      const raw = JSON.stringify(payload);
      this.#ws.send(raw);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  set heartbeatInterval(ms: number) {
    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer);
    }

    if (ms > 0) {
      this.#heartbeatTimer = setInterval(this.#heartbeat, ms);
    }
  }

  #heartbeat = () => {
    if (this.#heartbeatSent !== 0 && this.#missedHeartbeats >= 3) {
      this.#ws.close();
      this.heartbeatInterval = -1;
    }

    this.#missedHeartbeats++;
    this.#heartbeatSent = Date.now();

    const nonce = this.#heartbeatSent;
    this.sendPayload({
      op: VoiceOpcodes.Heartbeat,
      d: nonce
    })
  }

  get ping() {
    return this.#ping;
  }
}
