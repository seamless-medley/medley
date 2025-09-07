import crypto from 'node:crypto';
import { GatewayOpcodes } from "discord-api-types/v10";
import type { GatewayVoiceStateUpdateData, Snowflake } from "discord-api-types/v10";
import type { VoiceOpcodes } from "discord-api-types/voice/v8";

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

export type EncryptionMode = 'aead_aes256_gcm_rtpsize' | 'aead_xchacha20_poly1305_rtpsize';

export const ENCRYPTION_MODES = [
  // Required by voice v8
  'aead_xchacha20_poly1305_rtpsize'
] as EncryptionMode[];

// optional, if supported by the system
if (crypto.getCiphers().includes('aes-256-gcm')) {
  ENCRYPTION_MODES.push('aead_aes256_gcm_rtpsize');
}

export interface VoicePayload<D = unknown> extends Payload<VoiceOpcodes, D> {
  seq?: number;
}

type IdentifyData = {
  server_id: string;
  user_id: string;
  session_id: string;
  token: string;
  max_dave_protocol_version?: number;
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

// Since voice v8
export interface HeartbeatVoiceData {
  // Nonce
  t: number;
  // last sequence received
  seq_ack?: number;
}

// 3
export interface HeartbeatVoicePayload extends VoicePayload<HeartbeatVoiceData> {
  op: VoiceOpcodes.Heartbeat;
}

type SessionDescriptionData = {
  mode: EncryptionMode;
  secret_key: number[];
  dave_protocol_version: number;
}

// 4
export interface SessionDescriptionVoicePayload extends VoicePayload<SessionDescriptionData> {
  op: VoiceOpcodes.SessionDescription;
}

// 5
export interface SpeakingVoicePayload extends VoicePayload {
  op: VoiceOpcodes.Speaking;
}

export interface HeartbeatAckVoiceData {
  // Previous nonce
  t: number;
}
// 6
export interface HeartbeatAckVoicePayload extends VoicePayload<HeartbeatAckVoiceData> {
  op: VoiceOpcodes.HeartbeatAck;
}

export interface ResumeVoiceData extends Omit<IdentifyData, 'user_id'> {
  seq_ack?: number;
}

// 7
export interface ResumeVoicePayload extends VoicePayload<ResumeVoiceData> {
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

export interface ClientsConnectData {
  user_ids: Snowflake[];
}

// 11

export interface ClientsConnectPayload extends VoicePayload<ClientsConnectData> {
  op: VoiceOpcodes.ClientsConnect;
}

export interface ClientDisconnectData {
  user_id: Snowflake;
}

// 13
export interface ClientDisconnectVoicePayload extends VoicePayload<ClientDisconnectData> {
  op: VoiceOpcodes.ClientDisconnect;
}

export interface DavePrepareTransitionData {
  protocol_version: number;
  transition_id: number;
}

// 21
export interface DavePrepareTransitionPayload extends VoicePayload<DavePrepareTransitionData> {
  op: VoiceOpcodes.DavePrepareTransition;
}
export interface DaveExecuteTransitionData {
  transition_id: number;
}

// 22

export interface VoiceDaveExecuteTransitionPayload extends VoicePayload<DaveExecuteTransitionData> {
  op: VoiceOpcodes.DaveExecuteTransition;
}

export interface DaveTransitionReadyData {
  transition_id: number;
}

// 23

export interface DaveTransitionReadyPayload extends VoicePayload<DaveTransitionReadyData> {
  op: VoiceOpcodes.DaveTransitionReady;
}

export interface DavePrepareEpochData {
  protocol_version: number;
  epoch: number;
}

// 24
export interface DavePrepareEpochPayload extends VoicePayload<DavePrepareEpochData> {
  op: VoiceOpcodes.DavePrepareEpoch;
}

export interface DaveMlsInvalidCommitWelcomeData {
  transition_id: number;
}

// 31

export interface DaveMlsInvalidCommitWelcomePayload extends VoicePayload<DaveMlsInvalidCommitWelcomeData> {
  op: VoiceOpcodes.DaveMlsInvalidCommitWelcome;
}

export type VoiceClientPayload =
  IdentifyVoicePayload |
  SelectProtocolVoicePayload |
  HeartbeatVoicePayload |
  SpeakingVoicePayload |
  ResumeVoicePayload |
  DaveMlsInvalidCommitWelcomePayload |
  DaveTransitionReadyPayload
  ;

export type VoiceServerPayload =
  ReadyVoicePayload |
  SessionDescriptionVoicePayload |
  SpeakingVoicePayload |
  HeartbeatAckVoicePayload |
  HelloVoicePayload |
  ResumedVoicePayload |
  ClientsConnectPayload |
  ClientDisconnectVoicePayload |
  DavePrepareTransitionPayload |
  VoiceDaveExecuteTransitionPayload |
  DavePrepareEpochPayload
  ;

export const makeVoiceStateUpdatePayload = (data: GatewayVoiceStateUpdateData): GatewayVoiceStateUpdatePayload => ({
  op: GatewayOpcodes.VoiceStateUpdate,
  d: data
});

export const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
