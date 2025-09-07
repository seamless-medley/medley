import { isString } from "lodash";
import { TypedEmitter } from "tiny-typed-emitter";
import WebSocket from 'ws';
import { VoiceOpcodes } from 'discord-api-types/voice/v8';
import { VoiceClientPayload, VoiceServerPayload, HeartbeatAckVoicePayload, HeartbeatVoicePayload, ResumeVoicePayload } from "./payload";

export interface BinaryWebSocketMessage {
	op: VoiceOpcodes;
	payload: Buffer;
	seq: number;
}

export interface WebSocketConnectionEvents {
  open(event: WebSocket.Event): void;
  close(event: WebSocket.CloseEvent): void;
  error(error: Error): void;
  payload(payload: VoiceServerPayload): void;
  binary(message: BinaryWebSocketMessage): void;
  ping(latency: number): void;
}

export class WebSocketConnection extends TypedEmitter<WebSocketConnectionEvents> {
  readonly #ws: WebSocket;

  #heartbeatTimer?: NodeJS.Timeout;

  #seq?: number;

  #heartbeatSent = 0;
  #heartbeatAcked = 0;

  #missedHeartbeats = 0;

  #ping?: number;

  constructor(address: string, seq?: number) {
    super();

    this.#seq = seq;

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
    if (e.data instanceof Buffer || e.data instanceof ArrayBuffer) {
      const buffer = e.data instanceof ArrayBuffer ? Buffer.from(e.data) : e.data;
			const seq = buffer.readUInt16BE(0);
			const op = buffer.readUInt8(2);
			const payload = buffer.subarray(3);

      this.#seq = seq;

      this.emit('binary', { op, seq, payload });

      return;
    }

    if (!isString(e.data)) {
      return;
    }

    try {
			this.#handlePayload(JSON.parse(e.data) as VoiceServerPayload);
		} catch (error) {
			this.emit('error', error as Error);
		}
  }

  #handlePayload(payload: VoiceServerPayload) {
    if (payload.op === VoiceOpcodes.HeartbeatAck) {
      this.#updateHeartbeat(payload);
    }

    this.emit('payload', payload as VoiceServerPayload);
  }

  #updateHeartbeat(payload: HeartbeatAckVoicePayload) {
    this.#heartbeatAcked = Date.now();
    this.#missedHeartbeats = 0;
    this.#ping = this.#heartbeatAcked - this.#heartbeatSent;
    this.emit('ping', this.#ping);
  }

  #preparePayload(payload: VoiceClientPayload) {
    if (payload.op === VoiceOpcodes.Resume) {
      const resumePayload: ResumeVoicePayload = {
        ...payload,
        d: {
          ...payload.d,
          seq_ack: this.#seq
        }
      }

      return resumePayload;
    }

    return payload;
  }

  sendPayload(payload: VoiceClientPayload) {
    try {
      const prepared = this.#preparePayload(payload);
      const raw = JSON.stringify(prepared);
      this.#ws.send(raw);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  sendBinaryMessage(opcode: VoiceOpcodes, payload: Buffer) {
		try {
			const message = Buffer.concat([new Uint8Array([opcode]), payload]);
			this.#ws.send(message);
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
    const payload: HeartbeatVoicePayload = {
      op: VoiceOpcodes.Heartbeat,
      d: {
        t: nonce,
        seq_ack: this.#seq
      }
    };

    this.sendPayload(payload);
  }

  get ping() {
    return this.#ping;
  }

  set seq(value: number) {
    this.#seq = value;
  }
}
