import { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateData, GatewayVoiceStateUpdateDispatchData, Guild } from "discord.js";
import { TypedEmitter } from "tiny-typed-emitter";
import { CamelCase } from "type-fest";
import { makeVoiceStateUpdatePayload, Payload } from "./network/payload";
import { ConnectionStateCode, VoiceConnection, VoiceConnectionEvents } from './network/connection'
import { noop } from "lodash";
import EventEmitter, { once } from "node:events";
import { ICarrier } from "../../audio/exciter";
import { MedleyAutomaton } from "../automaton";

export enum VoiceConnectorStatus {
  Connecting = "connecting",
  Destroyed = "destroyed",
  Disconnected = "disconnected",
  Ready = "ready",
  Signalling = "signalling"
}

interface BaseVoiceState {
  status: VoiceConnectorStatus;
  //
  connection: VoiceConnection;
  gateway: GatewayFunctions;
}

interface ConnectingState extends BaseVoiceState {
  status: VoiceConnectorStatus.Connecting;
  reconnecting?: boolean;
}

interface SignallingState extends Omit<BaseVoiceState, 'connection'> {
  status: VoiceConnectorStatus.Signalling;
}

interface ReadyState extends BaseVoiceState {
  status: VoiceConnectorStatus.Ready;
}

interface DisconnectedBaseState extends Omit<BaseVoiceState, 'connection'> {
  status: VoiceConnectorStatus.Disconnected;
}

enum DisconnectReason {
  WebSocketClose,
  GatewayUnavailable,
  EndpointRemoved
}

interface DisconnectedState extends DisconnectedBaseState {
  reason: Exclude<DisconnectReason, DisconnectReason.WebSocketClose>;
}

interface DisconnectedWebSocketState extends DisconnectedBaseState {
  closeCode: number;
  reason: DisconnectReason.WebSocketClose;
}

interface DestroyedState {
  status: VoiceConnectorStatus.Destroyed;
}

type VoiceConnectorState = ConnectingState | SignallingState | ReadyState | DisconnectedState | DisconnectedWebSocketState | DestroyedState;

const isConnectionVoiceState = (state: any): state is BaseVoiceState => 'connection' in state;

interface GatewayHandler {
  onVoiceStateUpdate(data: GatewayVoiceStateUpdateDispatchData): void;
  onVoiceServerUpdate(data: GatewayVoiceServerUpdateDispatchData): void;
  destroy(): void;
}

interface GatewayFunctions {
  sendPayload(payload: Payload<any, any>): boolean;
  destroy(): void;
}

type DiscordGatewayAdapter = (handler: GatewayHandler) => GatewayFunctions;

type VoiceConnecterInternalData = {
  voiceServer?: GatewayVoiceServerUpdateDispatchData;
  voiceState?: GatewayVoiceStateUpdateDispatchData;
}

const connectors = new Map<MedleyAutomaton['id'], Map<Guild['id'], VoiceConnector>>();

export const getVoiceConnectors = (automatonId: MedleyAutomaton['id']) => connectors.get(automatonId);

export const getVoiceConnector = (automatonId: MedleyAutomaton['id'], guildId: string) => getVoiceConnectors(automatonId)?.get(guildId);

type VoiceConnectorEvents = {
  stateChange(oldState: VoiceConnectorState, newState: VoiceConnectorState): void;
  error(error: Error): void;
  ping(): void;
} & {
  [K in VoiceConnectorStatus]: (oldState: VoiceConnectorState, newState: VoiceConnectorState) => void;
}

export class VoiceConnector extends TypedEmitter<VoiceConnectorEvents> implements ICarrier {
  #state: VoiceConnectorState;

  readonly #data: VoiceConnecterInternalData = {};

  rejoinAttempts = 0;

  private constructor(private joinConfig: JoinConfig, adapter: DiscordGatewayAdapter) {
    super();

    const gateway = adapter({
      onVoiceStateUpdate: this.#onVoiceStateUpdate,
      onVoiceServerUpdate: this.#onVoiceServerUpdate,
      destroy: () => this.destroy(true)
    })

    this.#state = {
      status: VoiceConnectorStatus.Signalling,
      gateway
    };
  }

  destroy(fromGateway = false) {
    if (this.state.status === VoiceConnectorStatus.Destroyed) {
      throw new Error('Cannot destroy VoiceConnection - it has already been destroyed');
    }

    const { automatonId, guildId } = this.joinConfig;

    if (getVoiceConnector(automatonId, guildId) === this) {
      getVoiceConnectors(automatonId)?.delete(guildId);
    }

    if (!fromGateway) {
      const payload = makeVoiceStateUpdatePayload(joinConfig2Data({
        ...this.joinConfig,
        channelId: null
      }));

      this.state.gateway.sendPayload(payload);
    }

    this.state = { status: VoiceConnectorStatus.Destroyed };
  }

  get state(): VoiceConnectorState {
    return this.#state;
  }

  set state(newState: VoiceConnectorState) {
    const oldState = this.#state;

    const oldNetworking = Reflect.get(oldState, 'connection') as VoiceConnection | undefined;
    const newNetworking = Reflect.get(newState, 'connection') as VoiceConnection | undefined;

    if (oldNetworking !== newNetworking) {
      if (oldNetworking) {
        oldNetworking.on('error', noop);
        oldNetworking.off('error', this.#onConnectionError);
        oldNetworking.off('close', this.#onConnecitonClose);
        oldNetworking.off('stateChange', this.#onConnectionStateChange);
        oldNetworking.off('ping', this.#onConnectionPing)
        oldNetworking.destroy();
      }
    }

    if (newState.status === VoiceConnectorStatus.Ready) {
      this.rejoinAttempts = 0;
    }

    // If destroyed, the adapter can also be destroyed so it can be cleaned up by the user
    if (oldState.status !== VoiceConnectorStatus.Destroyed && newState.status === VoiceConnectorStatus.Destroyed) {
      oldState.gateway.destroy();
    }

    this.#state = newState;

    this.emit('stateChange', oldState, newState);

    if (oldState.status !== newState.status) {
      this.emit(newState.status, oldState, newState as any);
    }
  }

  get #readyState(): ReadyState | undefined {
    if (this.state.status === VoiceConnectorStatus.Ready) {
      return this.state;
    }
  }

  get isReady(): boolean {
    return this.state.status === VoiceConnectorStatus.Ready;
  }

  prepareAudioPacket(buffer: Buffer): Buffer | undefined {
    const state = this.#readyState;
    if (!state) {
      return;
    }

    return state.connection.prepareAudioPacket(buffer);
  }

  dispatchAudio(): boolean {
    if (this.#state.status !== VoiceConnectorStatus.Ready) {
      return false;
    }

    return this.#state.connection.dispatchAudio();
  }

  #onVoiceServerUpdate: GatewayHandler['onVoiceServerUpdate'] = (data) => {
    this.#data.voiceServer = data;

    if (data.endpoint) {
      this.configureConnection();
      return;
    }

    if (this.state.status !== VoiceConnectorStatus.Destroyed) {
      this.state = {
        ...this.state,
        status: VoiceConnectorStatus.Disconnected,
        reason: DisconnectReason.EndpointRemoved,
      };
    }
  }

  #onVoiceStateUpdate: GatewayHandler['onVoiceStateUpdate'] = (data) => {
    this.#data.voiceState = data;

    if (data.self_deaf !== undefined) {
      this.joinConfig.selfDeaf = data.self_deaf;
    }

    if (data.self_mute !== undefined) {
      this.joinConfig.selfMute = data.self_mute;
    }

    if (data.channel_id) {
      this.joinConfig.channelId = data.channel_id;
    }
  }

  configureConnection() {
    const { voiceServer, voiceState } = this.#data;

    if (!voiceServer || !voiceState) {
      return;
    }

    if (this.#state.status === VoiceConnectorStatus.Destroyed) {
      return;
    }

    if (!voiceServer.endpoint) {
      return;
    }

    const { endpoint, token, guild_id: guildId } = voiceServer;
    const { session_id: sessionId, user_id: userId } = voiceState;

    const connection = new VoiceConnection({
      endpoint,
      guildId,
      token,
      sessionId,
      userId
    });

    connection.on('stateChange', this.#onConnectionStateChange);
    connection.on('error', this.#onConnectionError);
    connection.on('close', this.#onConnecitonClose);
    connection.on('ping', this.#onConnectionPing);

    this.state = {
      ...this.#state,
      status: VoiceConnectorStatus.Connecting,
      connection
    }
  }

  #onConnectionStateChange: VoiceConnectionEvents['stateChange'] = (oldState, newState) => {
    if (oldState.code === newState.code) {
      return;
    }

    if (!isConnectionVoiceState(this.state)) {
      return;
    }

    const { connection, gateway } = this.state;

    if (newState.code === ConnectionStateCode.Ready) {
      this.state = {
        gateway,
        connection,
        status: VoiceConnectorStatus.Ready
      };

      return;
    }

    if (newState.code !== ConnectionStateCode.Closed) {
      this.state = {
        gateway,
        connection,
        status: VoiceConnectorStatus.Connecting,
        reconnecting: true
      };

      return;
    }
  }

  #onConnectionError: VoiceConnectionEvents['error'] = (error) => {
    this.emit('error', error);
  }

  #onConnectionPing: VoiceConnectionEvents['ping'] = () => {
    this.emit('ping');
  }

  #onConnecitonClose: VoiceConnectionEvents['close'] = (code) => {
    if (this.state.status === VoiceConnectorStatus.Destroyed) {
      return;
    }

    // https://discord.com/developers/docs/topics/opcodes-and-status-codes#voice
    const disconnectionCodes = [
      4014, // Should not reconnect, according to the documentation
      4022  // Undocumented, but seems to be sent when the bot is being moved to another channel
    ];

    // Should not reconnect
    if (disconnectionCodes.includes(code)) {
      this.state = {
        ...this.state,
        status: VoiceConnectorStatus.Disconnected,
        reason: DisconnectReason.WebSocketClose,
        closeCode: code,
      };

      return;
    }

    this.state = {
      ...this.state,
      status: VoiceConnectorStatus.Signalling,
    };

    this.rejoinAttempts++;

    const rejoinPayload = makeVoiceStateUpdatePayload(joinConfig2Data(this.joinConfig));

    if (!this.state.gateway.sendPayload(rejoinPayload)) {
      this.state = {
        ...this.state,
        status: VoiceConnectorStatus.Disconnected,
        reason: DisconnectReason.GatewayUnavailable,
      };
    }

  }

  get ping() {
    if (this.state.status === VoiceConnectorStatus.Ready) {
      const { connection } = this.state;

      if (connection.state.code === ConnectionStateCode.Ready) {
        return {
          ws: connection.state.ws.ping
        }
      }
    }

    return {
      ws: undefined
    }
  }

  async waitForState(status: VoiceConnectorStatus, timeoutOrSignal: AbortSignal | number) {
    if (this.#state.status === status) {
      return;
    }

    const [ac, signal] = typeof timeoutOrSignal !== 'number'
      ? [undefined, timeoutOrSignal]
      : (controller => {
          const timer = setTimeout(() => controller.abort(`timeout watiting for voice connector to become ${status} (${this.state.status})`), timeoutOrSignal);
          controller.signal.addEventListener('abort', () => clearTimeout(timer));
          return [controller, controller.signal];
        })(new AbortController)

    try {
      await once(this as EventEmitter, status, { signal });
      return this.state.status;
    }
    finally {
      ac?.abort();
    }
  }

  public rejoin(joinConfig?: Omit<JoinConfig, 'guildId' | 'automatonId'>) {
    if (this.#state.status === VoiceConnectorStatus.Destroyed) {
      return false;
    }

    const notReady = this.state.status !== VoiceConnectorStatus.Ready;

    if (notReady) {
      this.rejoinAttempts++;
    }

    Object.assign(this.joinConfig, joinConfig);

    if (this.#state.gateway.sendPayload(makeVoiceStateUpdatePayload(joinConfig2Data(this.joinConfig)))) {
      if (notReady) {
        this.state = {
          ...this.#state,
          status: VoiceConnectorStatus.Signalling,
        };
      }

      return true;
    }

    this.state = {
      gateway: this.#state.gateway,
      status: VoiceConnectorStatus.Disconnected,
      reason: DisconnectReason.GatewayUnavailable,
    };

    return false;
  }

  static connect(joinConfig: JoinConfig, adapter: DiscordGatewayAdapter) {
    const payload = makeVoiceStateUpdatePayload(joinConfig2Data(joinConfig));

    const group = connectors.get(joinConfig.automatonId) ?? (() => {
      const map = new Map<Guild['id'], VoiceConnector>();
      connectors.set(joinConfig.automatonId, map);
      return map;
    })();

    const existing = group.get(joinConfig.guildId);

    if (existing && existing.state.status !== VoiceConnectorStatus.Destroyed) {
      if (existing.state.status === VoiceConnectorStatus.Disconnected) {
        existing.rejoin({
          channelId: joinConfig.channelId,
          selfDeaf: joinConfig.selfDeaf,
          selfMute: joinConfig.selfMute,
        });
      } else if (!existing.state.gateway.sendPayload(payload)) {
        existing.state = {
          ...existing.state,
          status: VoiceConnectorStatus.Disconnected,
          reason: DisconnectReason.GatewayUnavailable,
        };
      }

      return existing;
    }

    const connector = new VoiceConnector(joinConfig, adapter);

    group.set(joinConfig.guildId, connector);

    if (connector.state.status !== VoiceConnectorStatus.Destroyed) {
      connector.state.gateway.sendPayload(payload);
    }

    return connector;
  }
}

type JoinConfig = {
  [K in keyof GatewayVoiceStateUpdateData as CamelCase<K>]: GatewayVoiceStateUpdateData[K];
} & {
  automatonId: MedleyAutomaton['id'];
}

const joinConfig2Data = ({ channelId, guildId, selfDeaf, selfMute }: JoinConfig): GatewayVoiceStateUpdateData => ({
  channel_id: channelId,
  guild_id: guildId,
  self_deaf: selfDeaf,
  self_mute: selfMute
});
