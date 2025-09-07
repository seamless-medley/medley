// Analog to djs Networking

import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { noop } from "lodash";
import { TypedEmitter } from "tiny-typed-emitter";
import { DAVE_PROTOCOL_VERSION } from "@snazzah/davey";
import { EncryptionMode, ENCRYPTION_MODES, ReadyVoicePayload } from "./payload";
import { SocketConfig, UDPConnection } from "./udp";
import { WebSocketConnection, WebSocketConnectionEvents } from "./websocket";
import * as secretbox from '../secretbox';
import { RTPData, createRTPHeader, incRTPData } from "../../../audio/network/rtp";
import { randomNBit } from "@seamless-medley/utils";
import { DaveSession, DaveSessionEvents } from "./dave";

export enum ConnectionStateCode {
  Opening,
  Identifying,
  UdpHandshaking,
  SelectingProtocol,
  Ready,
  Resuming,
  Closed,
}

interface BaseState {
  connectionOptions: ConnectionOptions;
  ws: WebSocketConnection;
  lastSeqReceived?: number;
}

interface OpeningState extends BaseState {
  code: ConnectionStateCode.Opening;
}

interface IdentifyingState extends BaseState {
  code: ConnectionStateCode.Identifying;
}

interface UdpHandshakingState extends BaseState {
  code: ConnectionStateCode.UdpHandshaking;
  //
  udp: UDPConnection;
  connectionData: Pick<ConnectionData, 'connectedClients' | 'ssrc'>;
}

interface SelectingProtocolState extends BaseState {
  code: ConnectionStateCode.SelectingProtocol;
  //
  udp: UDPConnection;
  connectionData: Pick<ConnectionData, 'connectedClients' | 'ssrc'>;
}

interface ReadyState extends BaseState {
  code: ConnectionStateCode.Ready;
  //
  udp: UDPConnection;
  dave?: DaveSession;
  connectionData: ConnectionData;
  preparedPacket?: Buffer;
}

interface ResumingState extends BaseState {
  code: ConnectionStateCode.Resuming;
  //
  udp: UDPConnection;
  dave?: DaveSession;
  connectionData: ConnectionData;
  preparedPacket?: Buffer;
}

interface ClosedState {
  code: ConnectionStateCode.Closed;
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
  channelId: string;
  endpoint: string;
  guildId: string;
  sessionId: string;
  token: string;
  userId: string;
}

export interface ConnectionData extends RTPData {
  connectedClients: Set<string>;
  encryptionMode: EncryptionMode;
  nonce: number;
  nonceBuffer: Buffer;
  packetsPlayed: number;
  secretKey: Uint8Array;
  speaking: boolean;
}

export interface VoiceConnectionEvents {
  stateChange(oldState: ConnectionState, newState: ConnectionState): void;
  close(code: number): void;
  error(error: Error): void;
  ping(): void;
  transitioned(transitionId: number): void;
}

export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
  #state: ConnectionState;

  #nonceBuffer = Buffer.alloc(24);

  constructor(connectionOptions: ConnectionOptions) {
    super();

    this.#state = {
      code: ConnectionStateCode.Opening,
      ws: this.#createWebSocket(connectionOptions.endpoint),
      connectionOptions
    }
  }

  public destroy() {
    this.state = { code: ConnectionStateCode.Closed };
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
      oldWs
        .on('error', noop)
        .off('error', this.#onError)
        .off('open', this.#onWsOpen)
        .off('payload', this.#onWsPayload)
        .off('binary', this.#onWsBinary)
        .off('close', this.#onWsClose)
        .off('ping', this.#onPing)
        .destroy()
    }

    const oldUdp = Reflect.get(oldState, 'udp') as UDPConnection | undefined;
    const newUdp = Reflect.get(newState, 'udp') as UDPConnection | undefined;

    if (oldUdp && oldUdp !== newUdp) {
      oldUdp.on('error', noop);
      oldUdp.off('error', this.#onError);
      oldUdp.off('close', this.#onUdpClose);
      oldUdp.destroy();
    }

    const oldDave = Reflect.get(oldState, 'dave') as DaveSession | undefined;
    const newDave = Reflect.get(newState, 'dave') as DaveSession | undefined;

    if (oldDave && oldDave !== newDave) {
      oldDave
        .off('keyPackage', this.#onDaveKeyPackage)
        .off('invalidateTransition', this.#onDaveInvalidateTransition)
        .destroy()
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

  #createDaveSession(protocolVersion: number) {
    if (this.#state.code !== ConnectionStateCode.SelectingProtocol && this.#state.code !== ConnectionStateCode.Ready && this.#state.code !== ConnectionStateCode.Resuming)  {
      return;
    }

    const session = new DaveSession(
      protocolVersion,
      this.#state.connectionOptions.userId,
      this.#state.connectionOptions.channelId
    );

    session
      .on('keyPackage', this.#onDaveKeyPackage)
      .on('invalidateTransition', this.#onDaveInvalidateTransition)
      .reinit();

    return session;
  }

  #onWsOpen: WebSocketConnectionEvents['open'] = () => {
    if (this.#state.code === ConnectionStateCode.Opening) {
      const { guildId: server_id, userId: user_id, sessionId: session_id, token } = this.#state.connectionOptions;

      this.#state.ws.sendPayload({
        op: VoiceOpcodes.Identify,
        d: {
          server_id,
          user_id,
          session_id,
          token,
          max_dave_protocol_version: DAVE_PROTOCOL_VERSION
        }
      });

      this.state = {
        ...this.#state,
        code: ConnectionStateCode.Identifying,
      };

      return;
    }

    if (this.#state.code === ConnectionStateCode.Resuming) {
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

  #onWsClose: WebSocketConnectionEvents['close'] = (e) => {
    this.emit('close', e.code);

    const canResume = e.code < 4000 || e.code === 4015;

    if (canResume && this.#state.code === ConnectionStateCode.Ready) {
      this.state = {
        ...this.#state,
        code: ConnectionStateCode.Resuming,
        ws: this.#createWebSocket(this.#state.connectionOptions.endpoint),
      };

      return;
    }

    if (this.#state.code !== ConnectionStateCode.Closed) {
      this.destroy();
      return;
    }
  }

  #onWsPayload: WebSocketConnectionEvents['payload'] = (payload) => {
    if (payload.seq && this.state.code !== ConnectionStateCode.Closed) {
      this.state.lastSeqReceived = payload.seq;
      this.state.ws.seq = payload.seq;
    }

    if (payload.op === VoiceOpcodes.Hello && this.state.code !== ConnectionStateCode.Closed) {
      this.state.ws.heartbeatInterval = payload.d.heartbeat_interval;
      return;
    }

    if (payload.op === VoiceOpcodes.Ready && this.#state.code === ConnectionStateCode.Identifying) {
      const udp = this.#createUDP(payload.d);

      udp.performIPDiscovery(payload.d.ssrc)
        .then(this.#handleIPDiscovery(payload.d.modes))
        .catch((error: Error) => {
          this.emit('error', error);
        });

      this.state = {
        ...this.#state,
        code: ConnectionStateCode.UdpHandshaking,
        udp,
        connectionData: {
          ssrc: payload.d.ssrc,
          connectedClients: new Set()
        },
      };

      return;
    }

    if (payload.op === VoiceOpcodes.SessionDescription && this.#state.code === ConnectionStateCode.SelectingProtocol) {
      const { mode: encryptionMode, secret_key: secretKey, dave_protocol_version: daveProtocolVersion } = payload.d;

      this.state = {
        ...this.#state,
        code: ConnectionStateCode.Ready,
        dave: this.#createDaveSession(daveProtocolVersion),
        connectionData: {
          ...this.#state.connectionData,
          encryptionMode,
          secretKey: new Uint8Array(secretKey),
          sequence: randomNBit(16),
          timestamp: randomNBit(32),
          nonce: 0,
          nonceBuffer: Buffer.alloc(encryptionMode === 'aead_aes256_gcm_rtpsize' ? 12 : 24),
          speaking: false,
          packetsPlayed: 0,
        },
      };

      return;
    }

    if (payload.op === VoiceOpcodes.Resumed && this.#state.code === ConnectionStateCode.Resuming) {
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
        code: ConnectionStateCode.Ready,
      };

      this.state.connectionData.speaking = false;

      return;
    }

    if ((payload.op === VoiceOpcodes.ClientsConnect || payload.op === VoiceOpcodes.ClientDisconnect) &&
        (this.#state.code === ConnectionStateCode.Ready || this.#state.code === ConnectionStateCode.UdpHandshaking || this.#state.code === ConnectionStateCode.SelectingProtocol || this.#state.code === ConnectionStateCode.Resuming))
    {
      const { connectionData } = this.#state;

      if (payload.op === VoiceOpcodes.ClientsConnect)
        for (const id of payload.d.user_ids) {
          connectionData.connectedClients.add(id);
        }
      else {
        connectionData.connectedClients.delete(payload.d.user_id);
      }

      return;
    }

    if ((this.#state.code === ConnectionStateCode.Ready || this.#state.code === ConnectionStateCode.Resuming) && this.#state.dave) {

      if (payload.op === VoiceOpcodes.DavePrepareTransition) {
        // Downgrade, someone else does not support the protocol we're currently using

        const sendReady = this.#state.dave.prepareTransition(payload.d);

        if (sendReady) {
          this.#state.ws.sendPayload({
            op: VoiceOpcodes.DaveTransitionReady,
            d: { transition_id: payload.d.transition_id },
          });
        }

        if (payload.d.transition_id === 0) {
          this.emit('transitioned', 0);

        }
      } else if (payload.op === VoiceOpcodes.DaveExecuteTransition) {
        const transitioned = this.#state.dave.executeTransition(payload.d.transition_id);

        if (transitioned) {
          this.emit('transitioned', payload.d.transition_id);
        }

      } else if (payload.op === VoiceOpcodes.DavePrepareEpoch) {
        this.#state.dave?.prepareEpoch(payload.d);
      }
    }
  }

  #onWsBinary: WebSocketConnectionEvents['binary'] = (message) => {
    if (this.#state.code !== ConnectionStateCode.Ready || !this.#state.dave) {
      return;
    }

    if (message.op === VoiceOpcodes.DaveMlsExternalSender) {
      this.#state.dave.setExternalSender(message.payload);
      return;
    }

    if (message.op === VoiceOpcodes.DaveMlsProposals) {
      const payload = this.#state.dave.processProposals(message.payload, this.#state.connectionData.connectedClients);
      if (payload) {
        this.#state.ws.sendBinaryMessage(VoiceOpcodes.DaveMlsCommitWelcome, payload);
      }

      return;
    }

    if (message.op === VoiceOpcodes.DaveMlsAnnounceCommitTransition) {
      const { transitionId, success } = this.#state.dave.processCommit(message.payload);

      if (success) {
        if (transitionId === 0) {
          this.emit('transitioned', transitionId);
        } else {
          this.#state.ws.sendPayload({
            op: VoiceOpcodes.DaveTransitionReady,
            d: { transition_id: transitionId },
          });
        }
      }

      return;
    }

    if (message.op === VoiceOpcodes.DaveMlsWelcome) {
      const { transitionId, success } = this.#state.dave.processWelcome(message.payload);

      if (success) {
        if (transitionId === 0) {
          this.emit('transitioned', transitionId);
        } else {
          this.#state.ws.sendPayload({
            op: VoiceOpcodes.DaveTransitionReady,
            d: { transition_id: transitionId },
          });
        }
      }

      return;
    }
  }

  #onDaveKeyPackage: DaveSessionEvents['keyPackage'] = (keyPackage) => {
    if (this.#state.code === ConnectionStateCode.SelectingProtocol || this.#state.code === ConnectionStateCode.Ready) {
      this.#state.ws.sendBinaryMessage(VoiceOpcodes.DaveMlsKeyPackage, keyPackage);
    }
  }

  #onDaveInvalidateTransition: DaveSessionEvents['invalidateTransition'] = (transitionId) => {
    if (this.#state.code === ConnectionStateCode.SelectingProtocol || this.#state.code === ConnectionStateCode.Ready) {
      this.#state.ws.sendPayload({
        op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
        d: { transition_id: transitionId },
      });
    }
  }

  #onUdpClose = () => {
    if (this.#state.code === ConnectionStateCode.Ready) {
      this.#state.ws.off('close', this.#onWsClose);

      this.state = {
        ...this.#state,
        code: ConnectionStateCode.Resuming,
        ws: this.#createWebSocket(this.#state.connectionOptions.endpoint),
      };
    }
  }

  #createWebSocket(endpoint: string) {
    return new WebSocketConnection(`wss://${endpoint}?v=8`, (this.state as any)?.lastSeqReceived)
      .once('open', this.#onWsOpen)
      .once('close', this.#onWsClose)
      .on('error',this.#onError)
      .on('payload', this.#onWsPayload)
      .on('binary', this.#onWsBinary)
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
      if (this.#state.code !== ConnectionStateCode.UdpHandshaking) {
        return;
      }

      const mode = chooseEncryptionMode(modes);

      this.#state.ws.sendPayload({
        op: VoiceOpcodes.SelectProtocol,
        d: {
          protocol: 'udp',
          data: {
            address,
            port,
            mode,
          },
        },
      });

      this.state = {
        ...this.#state,
        code: ConnectionStateCode.SelectingProtocol,
      };
    }
  }

  #createAudioPacket(opusPacket: Buffer, connectionData: ConnectionData, daveSession?: DaveSession) {
    const header = createRTPHeader({
      ssrc: connectionData.ssrc,
      sequence: connectionData.sequence,
      timestamp: connectionData.timestamp,
      payloadType: 0x78
    });

    header.copy(this.#nonceBuffer, 0, 0, 12);

    return Buffer.concat(packVoiceData(
      opusPacket,
      header,
      connectionData,
      daveSession
    ))
  }

  prepareAudioPacket(opusPacket: Buffer): Buffer | undefined {
    if (this.#state.code !== ConnectionStateCode.Ready) {
      return;
    }

    this.#state.preparedPacket = this.#createAudioPacket(opusPacket, this.#state.connectionData, this.#state.dave);
    return this.#state.preparedPacket;
  }

  dispatchAudio() {
    if (this.#state.code !== ConnectionStateCode.Ready) {
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
    if (this.#state.code !== ConnectionStateCode.Ready) {
      return;
    }

    const { connectionData } = this.#state;
    connectionData.packetsPlayed++;

    incRTPData(connectionData);

    this.setSpeaking(true);
    this.#state.udp.send(audioPacket);
  }

  setSpeaking(speaking: boolean) {
    if (this.#state.code !== ConnectionStateCode.Ready) {
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
}

function chooseEncryptionMode(serverModes: EncryptionMode[]) {
  const mode = serverModes.find(mode => ENCRYPTION_MODES.includes(mode));

  if (!mode) {
    throw new Error(`No compatible encryption modes. Available include: ${serverModes.join(', ')}`);
  }

  return mode;
}

function packVoiceData(opusPacket: Buffer, header: Buffer, connectionData: ConnectionData, daveSession?: DaveSession) {
  const { secretKey, encryptionMode } = connectionData;

  const packet = daveSession?.encrypt(opusPacket) ?? opusPacket;

  connectionData.nonce++;

  if (connectionData.nonce > 2 ** 32 - 1) {
    connectionData.nonce = 0;
  }

  connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);

  const noncePadding = connectionData.nonceBuffer.subarray(0, 4);

  const secretKeyBuffer = Buffer.from(secretKey);

  switch (encryptionMode) {
    case 'aead_xchacha20_poly1305_rtpsize': {
      return [
        header,
        secretbox.aeadClose(packet, header, connectionData.nonceBuffer, secretKeyBuffer),
        noncePadding
      ];
    }

    case 'aead_aes256_gcm_rtpsize': {
      return [
        header,
        secretbox.gcmClose(packet, header, connectionData.nonceBuffer, secretKeyBuffer),
        noncePadding
      ]
    }
  }

  return [];
}
