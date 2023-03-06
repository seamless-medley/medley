import { GatewayOpcodes, GatewayVoiceStateUpdateData } from "discord-api-types/v10";
import { VoiceOpcodes } from "discord-api-types/voice/v4";

export interface Payload<OP, D> {
  op: OP;
  d: D;
  // s?: number;
  // t?: string;
}

export interface GatewayVoicePayload<D> extends Payload<GatewayOpcodes, D> {

}

export interface GatewayVoiceStateUpdatePayload extends GatewayVoicePayload<GatewayVoiceStateUpdateData> {

}

export const ENCRYPTION_MODES = ['xsalsa20_poly1305_lite', 'xsalsa20_poly1305_suffix', 'xsalsa20_poly1305'] as const;

export type EncryptionMode = typeof ENCRYPTION_MODES[number];

export interface VoicePayload<D = unknown> extends Payload<VoiceOpcodes, D> {

}

type IdentifyData = {
  server_id: string;
  user_id: string;
  session_id: string;
  token: string;
}

// 0
export interface IdentifyVoicePayload extends VoicePayload<IdentifyData> {
  op: VoiceOpcodes.Identify;
}

type SelectProtocolData = {
  protocol: 'udp';
  data: {
    address: string;
    port: number;
    mode: EncryptionMode;
  }
}

// 1
export interface SelectProtocolVoicePayload extends VoicePayload<SelectProtocolData> {
  op: VoiceOpcodes.SelectProtocol;
}

type ReadyVoiceData = {
  ssrc: number;
  ip: string;
  port: number;
  modes: EncryptionMode[],
  heartbeat_interval: number;
}

// 2
export interface ReadyVoicePayload extends VoicePayload<ReadyVoiceData> {
  op: VoiceOpcodes.Ready;
}

// 3
export interface HeartbeatVoicePayload extends VoicePayload<number> {
  op: VoiceOpcodes.Heartbeat;
}

type SessionDescriptionData = {
  mode: EncryptionMode;
  secret_key: number[];
}

// 4
export interface SessionDescriptionVoicePayload extends VoicePayload<SessionDescriptionData> {
  op: VoiceOpcodes.SessionDescription;
}

// 5
export interface SpeakingVoicePayload extends VoicePayload {
  op: VoiceOpcodes.Speaking;
}

// 6
export interface HeartbeatAckVoicePayload extends VoicePayload {
  op: VoiceOpcodes.HeartbeatAck;
}

// 7
export interface ResumeVoicePayload extends VoicePayload<Omit<IdentifyData, 'user_id'>> {
  op: VoiceOpcodes.Resume;
}

// 8
export interface HelloVoicePayload extends VoicePayload<{ heartbeat_interval: number }> {
  op: VoiceOpcodes.Hello;
}

// 9
export interface ResumedVoicePayload extends VoicePayload {
  op: VoiceOpcodes.Resumed;
}

// 13
export interface ClientDisconnectVoicePayload extends VoicePayload {
  op: VoiceOpcodes.ClientDisconnect;
}

export type VoiceClientPayload =
  IdentifyVoicePayload |
  SelectProtocolVoicePayload |
  HeartbeatVoicePayload |
  SpeakingVoicePayload |
  ResumeVoicePayload;

export type VoiceServerPayload =
  ReadyVoicePayload |
  SessionDescriptionVoicePayload |
  SpeakingVoicePayload |
  HeartbeatAckVoicePayload |
  HelloVoicePayload |
  ResumedVoicePayload |
  ClientDisconnectVoicePayload;

export const makeVoiceStateUpdatePayload = (data: GatewayVoiceStateUpdateData): GatewayVoiceStateUpdatePayload => ({
  op: GatewayOpcodes.VoiceStateUpdate,
  d: data
})
