// Analog to djs Networking

import { VoiceOpcodes } from "discord-api-types/voice/v4";
import { noop } from "lodash";
import { TypedEmitter } from "tiny-typed-emitter";
import { EncryptionMode, ENCRYPTION_MODES, ReadyVoicePayload } from "./payload";
import { SocketConfig, UDPConnection } from "./udp";
import { WebSocketConnection, WebSocketConnectionEvents } from "./websocket";
import * as secretbox from '../secretbox';

export enum ConnectionStatus {
	Opening,
	Identifying,
	UdpHandshaking,
	SelectingProtocol,
	Ready,
	Resuming,
	Closed,
}

interface State {
  status: ConnectionStatus;
	connectionOptions: ConnectionOptions;
	ws: WebSocketConnection;
}

interface StateWithUDP extends State {
  udp: UDPConnection;
  connectionData: Pick<ConnectionData, 'ssrc'>;
}

interface StateWithPacket extends StateWithUDP {
  preparedPacket?: Buffer;
}

interface OpeningState extends State {
  status: ConnectionStatus.Opening;
}

interface IdentifyingState extends State {
  status: ConnectionStatus.Identifying;
}

interface UdpHandshakingState extends StateWithUDP {
  status: ConnectionStatus.UdpHandshaking;
}

interface SelectingProtocolState extends StateWithUDP {
  status: ConnectionStatus.SelectingProtocol;
}

interface ReadyState extends StateWithPacket {
  status: ConnectionStatus.Ready;
  connectionData: ConnectionData;
}

interface ResumingState extends StateWithPacket {
  status: ConnectionStatus.Resuming;
  connectionData: ConnectionData;
}

interface ClosedState extends Pick<State, 'status'> {
  status: ConnectionStatus.Closed;
}

type ConnectionState =
  OpeningState |
  IdentifyingState |
  UdpHandshakingState |
  SelectingProtocolState |
  ReadyState |
  ResumingState |
  ClosedState;

export type ConnectionOptions = {
	endpoint: string;
	guildId: string;
	sessionId: string;
	token: string;
	userId: string;
}

export interface ConnectionData {
	encryptionMode: EncryptionMode;
	nonce: number;
	nonceBuffer: Buffer;
	packetsPlayed: number;
	secretKey: Uint8Array;
	sequence: number;
	speaking: boolean;
	ssrc: number;
	timestamp: number;
}

export interface VoiceConnectionEvents {
  stateChange(oldState: ConnectionState, newState: ConnectionState): void;
  close(code: number): void;
  error(error: Error): void;
  ping(): void;
}

export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
  #state: ConnectionState;

  #nonceBuffer = Buffer.alloc(24);

  constructor(connectionOptions: ConnectionOptions) {
    super();

    this.#state = {
      status: ConnectionStatus.Opening,
      ws: this.#createWebSocket(connectionOptions.endpoint),
      connectionOptions
    }
  }

	public destroy() {
		this.state = { status: ConnectionStatus.Closed };
	}

  get state() {
    return this.#state;
  }

  set state(newState: ConnectionState) {
    const oldState = this.#state;

    const oldWs = Reflect.get(oldState, 'ws') as WebSocketConnection | undefined;
    const newWs = Reflect.get(oldState, 'ws') as WebSocketConnection | undefined;

    if (oldWs && oldWs !== newWs) {
      // The old WebSocket is being freed - remove all handlers from it
      oldWs.on('error', noop);
      oldWs.off('error', this.#onError);
      oldWs.off('open', this.#onWsOpen);
      oldWs.off('payload', this.#onWsPayload);
      oldWs.off('close', this.#onWsClose);
      oldWs.off('ping', this.#onPing);
      oldWs.destroy();
    }

		const oldUdp = Reflect.get(oldState, 'udp') as UDPConnection | undefined;
		const newUdp = Reflect.get(newState, 'udp') as UDPConnection | undefined;

    if (oldUdp && oldUdp !== newUdp) {
			oldUdp.on('error', noop);
			oldUdp.off('error', this.#onError);
			oldUdp.off('close', this.#onUdpClose);
			oldUdp.destroy();
		}


    this.#state = newState;

    this.emit('stateChange', oldState, newState);
  }

  #onError = (e: Error) => {
    this.emit('error', e);
  }

  #onPing = () => {
    this.emit('ping');
  }

  #onWsOpen: WebSocketConnectionEvents['open'] = () => {
    if (this.#state.status === ConnectionStatus.Opening) {

      const { guildId: server_id, userId: user_id, sessionId: session_id, token } = this.#state.connectionOptions;

      this.#state.ws.sendPayload({
        op: VoiceOpcodes.Identify,
        d: {
          server_id,
          user_id,
          session_id,
          token
        }
      });

      this.state = {
				...this.#state,
				status: ConnectionStatus.Identifying,
			};

      return;
    }

    if (this.#state.status === ConnectionStatus.Resuming) {
      const { guildId: server_id, sessionId: session_id, token } = this.#state.connectionOptions;

      this.#state.ws.sendPayload({
        op: VoiceOpcodes.Resume,
        d: {
          server_id,
          session_id,
          token
        }
      });

      return;
    }
  }

  #onWsClose: WebSocketConnectionEvents['close'] = ({ code }) => {
    const canResume = code < 4000 || code === 4015;

    if (canResume && this.#state.status === ConnectionStatus.Ready) {
      this.state = {
				...this.#state,
				status: ConnectionStatus.Resuming,
				ws: this.#createWebSocket(this.#state.connectionOptions.endpoint),
			};

      return;
    }

    if (this.#state.status !== ConnectionStatus.Closed) {
      this.destroy();
			this.emit('close', code);
      return;
    }
  }

  #onWsPayload: WebSocketConnectionEvents['payload'] = (payload) => {
    if (payload.op === VoiceOpcodes.Hello) {
      const ws = Reflect.get(this.#state, 'ws') as WebSocketConnection | undefined;

      if (ws) {
        ws.heartbeatInterval = payload.d.heartbeat_interval;
      }

      return;
    }

    if (payload.op === VoiceOpcodes.Ready && this.#state.status === ConnectionStatus.Identifying) {
      const udp = this.#createUDP(payload.d);

      udp.performIPDiscovery(payload.d.ssrc)
        .then(this.#handleIPDiscovery(payload.d.modes))
        .catch((error: Error) => {
          this.emit('error', error);
        });

			this.state = {
				...this.#state,
				status: ConnectionStatus.UdpHandshaking,
				udp,
				connectionData: { ssrc: payload.d.ssrc },
			};

      return;
    }

    if (payload.op === VoiceOpcodes.SessionDescription && this.#state.status === ConnectionStatus.SelectingProtocol) {
      const { mode: encryptionMode, secret_key: secretKey } = payload.d;

      this.state = {
				...this.#state,
				status: ConnectionStatus.Ready,
				connectionData: {
					...this.#state.connectionData,
					encryptionMode,
					secretKey: new Uint8Array(secretKey),
					sequence: randomNBit(16),
					timestamp: randomNBit(32),
					nonce: 0,
					nonceBuffer: Buffer.alloc(24),
					speaking: false,
					packetsPlayed: 0,
				},
			};

      return;
    }

    if (payload.op === VoiceOpcodes.Resumed && this.#state.status === ConnectionStatus.Resuming) {
      const config = this.#state.udp.config;
      const connectionData = this.#state.connectionData;

      const udp = this.#createUDP({
        ip: config.ip,
        port: config.port,
        modes: [connectionData.encryptionMode],
        ssrc: connectionData.ssrc,
        heartbeat_interval: this.#state.ws.heartbeatInterval
      });

      this.state = {
				...this.#state,
        udp,
				status: ConnectionStatus.Ready,
			};

			this.state.connectionData.speaking = false;

      return;
    }
  }

  #onUdpClose = () => {
    if (this.#state.status === ConnectionStatus.Ready) {
      this.#state.ws.off('close', this.#onWsClose);

			this.state = {
				...this.#state,
				status: ConnectionStatus.Resuming,
				ws: this.#createWebSocket(this.#state.connectionOptions.endpoint),
			};
		}
  }

  #createWebSocket(endpoint: string) {
    return new WebSocketConnection(`wss://${endpoint}?v=4`)
      .once('open', this.#onWsOpen)
      .once('close', this.#onWsClose)
      .on('error',this.#onError)
      .on('payload', this.#onWsPayload)
      .on('ping', this.#onPing)
  }

  #createUDP({ ip, port, ssrc, modes }: ReadyVoicePayload['d']) {
    const udp = new UDPConnection({ ip, port })
      .on('error', this.#onError)
      .once('close', this.#onUdpClose);



    return udp;
  }

  #handleIPDiscovery(modes: EncryptionMode[]) {
    return ({ ip: address, port }: SocketConfig) => {
      if (this.#state.status !== ConnectionStatus.UdpHandshaking) {
        return;
      }

      this.#state.ws.sendPayload({
        op: VoiceOpcodes.SelectProtocol,
        d: {
          protocol: 'udp',
          data: {
            address,
            port,
            mode: chooseEncryptionMode(modes),
          },
        },
      });

      this.state = {
        ...this.#state,
        status: ConnectionStatus.SelectingProtocol,
      };
    }
  }

  #createAudioPacket(opusPacket: Buffer, connectionData: ConnectionData) {
    const { sequence, timestamp, ssrc } = connectionData;

    const header = Buffer.alloc(12);
    header.writeUInt8(0x80, 0);
    header.writeUInt8(0x78, 1);
    header.writeUIntBE(sequence, 2, 2);
		header.writeUIntBE(timestamp, 4, 4);
		header.writeUIntBE(ssrc, 8, 4);

    header.copy(this.#nonceBuffer, 0, 0, 12);

    return Buffer.concat([
      header,
      ...encryptOpusPacket(opusPacket, connectionData, this.#nonceBuffer)
    ])
  }

	prepareAudioPacket(opusPacket: Buffer): Buffer | undefined {
		if (this.#state.status !== ConnectionStatus.Ready) {
      return;
    }

		this.#state.preparedPacket = this.#createAudioPacket(opusPacket, this.#state.connectionData);
		return this.#state.preparedPacket;
	}

	dispatchAudio() {
		if (this.#state.status !== ConnectionStatus.Ready) {
      return false;
    }

		if (this.#state.preparedPacket !== undefined) {
			this.#sendAudioPacket(this.#state.preparedPacket);
			this.#state.preparedPacket = undefined;
			return true;
		}

		return false;
	}

	#sendAudioPacket(audioPacket: Buffer) {
		if (this.#state.status !== ConnectionStatus.Ready) {
      return;
    }

		const { connectionData } = this.#state;
		connectionData.packetsPlayed++;
		connectionData.sequence++;
		connectionData.timestamp += 960;

		if (connectionData.sequence >= 2 ** 16) {
      connectionData.sequence = 0;
    }

		if (connectionData.timestamp >= 2 ** 32) {
      connectionData.timestamp = 0;
    }

		this.setSpeaking(true);
		this.#state.udp.send(audioPacket);
	}

  setSpeaking(speaking: boolean) {
		if (this.#state.status !== ConnectionStatus.Ready) {
      return;
    }

		if (this.#state.connectionData.speaking === speaking) {
      return;
    }

		this.#state.connectionData.speaking = speaking;
		this.#state.ws.sendPayload({
			op: VoiceOpcodes.Speaking,
			d: {
				speaking: speaking ? 1 : 0,
				delay: 0,
				ssrc: this.#state.connectionData.ssrc,
			},
		});
	}

  get ping() {
    const ws = Reflect.get(this.#state, 'ws') as WebSocketConnection | undefined;
    const udp = Reflect.get(this.#state, 'udp') as UDPConnection | undefined;

    return {
      ws: ws?.ping,
      udp: udp?.ping
    }
  }
}

const randomNBit = (numberOfBits: number) => Math.floor(Math.random() * 2 ** numberOfBits);

function chooseEncryptionMode(options: EncryptionMode[]) {
	const option = options.find((option) => ENCRYPTION_MODES.includes(option));

	if (!option) {
		throw new Error(`No compatible encryption modes. Available include: ${options.join(', ')}`);
	}

	return option;
}

function encryptOpusPacket(opusPacket: Buffer, connectionData: ConnectionData, nonce: Buffer) {
  const { secretKey, encryptionMode } = connectionData;

  const secretKeyBuffer = Buffer.from(secretKey);

  if (encryptionMode === 'xsalsa20_poly1305_lite') {
    connectionData.nonce++;

    if (connectionData.nonce > 2 ** 32 - 1) {
      connectionData.nonce = 0;
    }

    connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);

    return [
      secretbox.close(opusPacket, connectionData.nonceBuffer, secretKeyBuffer),
      connectionData.nonceBuffer.subarray(0, 4),
    ];
  }

  if (encryptionMode === 'xsalsa20_poly1305_suffix') {
    const random = secretbox.random(24, connectionData.nonceBuffer);
    return [
      secretbox.close(opusPacket, random, secretKeyBuffer),
      random
    ];
  }

  return [
    secretbox.close(opusPacket, nonce, secretKeyBuffer)
  ];
}
