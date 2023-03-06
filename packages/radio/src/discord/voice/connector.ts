import { AudioPlayer, PlayerSubscription, VoiceConnection } from "@discordjs/voice";
import { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateData, GatewayVoiceStateUpdateDispatchData } from "discord.js";
import { TypedEmitter } from "tiny-typed-emitter";
import { CamelCase } from "type-fest";
import { makeVoiceStateUpdatePayload, Payload } from "./network/payload";
import { ConnectionStatus, VoiceConnection as MedleyVoiceConnection, VoiceConnectionEvents } from './network/connection'
import { noop } from "lodash";
import EventEmitter, { once } from "events";

type VoiceAudioConnection = Pick<VoiceConnection, 'prepareAudioPacket' | 'dispatchAudio' | 'setSpeaking'>;

export enum VoiceConnectorStatus {
  /**
   * The `VOICE_SERVER_UPDATE` and `VOICE_STATE_UPDATE` packets have been received, now attempting to establish a voice connection.
   */
  Connecting = "connecting",
  /**
   * The voice connection has been destroyed and untracked, it cannot be reused.
   */
  Destroyed = "destroyed",
  /**
   * The voice connection has either been severed or not established.
   */
  Disconnected = "disconnected",
  /**
   * A voice connection has been established, and is ready to be used.
   */
  Ready = "ready",
  /**
   * Sending a packet to the main Discord gateway to indicate we want to change our voice state.
   */
  Signalling = "signalling"
}

interface State {
  status: VoiceConnectorStatus;
  //
  connection: MedleyVoiceConnection;
  gateway: GatewayFunctions;
  subscription?: PlayerSubscription | undefined;
}

interface ConnectingState extends State {
  status: VoiceConnectorStatus.Connecting;
}

interface SignallingState extends Omit<State, 'connection'> {
  status: VoiceConnectorStatus.Signalling;
}

interface ReadyState extends State {
  status: VoiceConnectorStatus.Ready;
}

interface DisconnectedBaseState extends Omit<State, 'connection'> {
  status: VoiceConnectorStatus.Disconnected;
}

enum DisconnectReason {
  /**
   * When the WebSocket connection has been closed.
   */
  WebSocketClose = 0,
  /**
   * When the adapter was unable to send a message requested by the VoiceConnection.
   */
  AdapterUnavailable = 1,
  /**
   * When a VOICE_SERVER_UPDATE packet is received with a null endpoint, causing the connection to be severed.
   */
  EndpointRemoved = 2,
  /**
   * When a manual disconnect was requested.
   */
  Manual = 3
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

// TODO: This must be compatible with djs VoiceConnection
export class VoiceConnector extends TypedEmitter implements VoiceAudioConnection {
  #state: VoiceConnectorState;

  readonly #data: VoiceConnecterInternalData = {};

  rejoinAttempts = 0;

  constructor(private joinConfig: JoinConfig, adapter: DiscordGatewayAdapter) {
    super();

    const gateway = adapter({
      onVoiceStateUpdate: this.#onVoiceStateUpdate,
      onVoiceServerUpdate: this.#onVoiceServerUpdate,
      destroy: () => this.destroy(true)
    })

    this.#state = { status: VoiceConnectorStatus.Signalling, gateway };
  }

  destroy(fromGateway = false) {
    if (this.state.status === VoiceConnectorStatus.Destroyed) {
			throw new Error('Cannot destroy VoiceConnection - it has already been destroyed');
		}

    // TODO: untrack
		// if (getVoiceConnection(this.joinConfig.guildId, this.joinConfig.group) === this) {
		// 	untrackVoiceConnection(this);
		// }

    if (!fromGateway) {
			this.state.gateway.sendPayload(makeVoiceStateUpdatePayload(joinConfig2Data({ ...this.joinConfig, channelId: null })));
		}

		this.state = { status: VoiceConnectorStatus.Destroyed };
  }

  get state(): VoiceConnectorState {
    return this.#state;
  }

  set state(newState: VoiceConnectorState) {
    const oldState = this.#state;

		const oldNetworking = Reflect.get(oldState, 'connection') as MedleyVoiceConnection | undefined;
		const newNetworking = Reflect.get(newState, 'connection') as MedleyVoiceConnection | undefined;

		const oldSubscription = Reflect.get(oldState, 'subscription') as PlayerSubscription | undefined;
		const newSubscription = Reflect.get(newState, 'subscription') as PlayerSubscription | undefined;

    if (oldNetworking !== newNetworking) {
      if (oldNetworking) {
				oldNetworking.on('error', noop);
				oldNetworking.off('error', this.#onConnectionError);
				oldNetworking.off('close', this.#onConnecitonClose);
				oldNetworking.off('stateChange', this.#onConnectionStateChange);
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

		if (oldSubscription && oldSubscription !== newSubscription) {
      console.log('Subsription change');
			oldSubscription.unsubscribe();
		}

		this.emit('stateChange', oldState, newState);

		if (oldState.status !== newState.status) {
			this.emit(newState.status, oldState, newState as any);
		}
  }

  get #readyState() {
    if (this.state.status === VoiceConnectorStatus.Ready) {
      return this.state as ReadyState;
    }
  }

  prepareAudioPacket(buffer: Buffer): Buffer | undefined {
    const state = this.#readyState;
    if (!state) {
      return;
    }

    return state.connection.prepareAudioPacket(buffer);
  }

  dispatchAudio(): boolean | undefined {
		if (this.#state.status !== VoiceConnectorStatus.Ready) {
      console.log('Cannot dispatchAudio', this.#state.status);
      return;
    }

		return this.#state.connection.dispatchAudio();
  }

  setSpeaking(enabled: boolean): false | void {
    if (this.state.status !== VoiceConnectorStatus.Ready) {
      return false;
    }

		return this.state.connection.setSpeaking(enabled);
  }

  // TODO: This is a temp, to mimic djs voice
  // In the real case, this should be an exciter instead of player
  subscribe(player: AudioPlayer): PlayerSubscription | undefined {
    if (this.state.status === VoiceConnectorStatus.Destroyed) {
      return;
    }

		// eslint-disable-next-line @typescript-eslint/dot-notation
		const subscription = player['subscribe'](this);

		this.state = {
			...this.state,
			subscription,
		};

		return subscription;
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

    const connection = new MedleyVoiceConnection({
      endpoint,
      guildId,
      token,
      sessionId,
      userId
    });

    connection.on('stateChange', this.#onConnectionStateChange);
    connection.on('error', this.#onConnectionError);
    connection.once('close', this.#onConnecitonClose);

    this.state = {
      ...this.#state,
      status: VoiceConnectorStatus.Connecting,
      connection
    }
  }

  #onConnectionStateChange: VoiceConnectionEvents['stateChange'] = (oldState, newState) => {
    if (oldState.status === newState.status) {
      return;
    }

    if (this.state.status !== VoiceConnectorStatus.Connecting && this.state.status !== VoiceConnectorStatus.Ready) {
			return;
    }

    if (newState.status === ConnectionStatus.Ready) {
			this.state = {
				...this.state,
				status: VoiceConnectorStatus.Ready,
			};

      return;
		}

    if (newState.status !== ConnectionStatus.Closed) {
			this.state = {
				...this.state,
				status: VoiceConnectorStatus.Connecting,
			};

      return;
		}
  }

  #onConnectionError: VoiceConnectionEvents['error'] = (error) => {
    this.emit('error', error);
  }

  #onConnecitonClose: VoiceConnectionEvents['close'] = (code) => {
    if (this.state.status === VoiceConnectorStatus.Destroyed) {
      return;
    }

    if (code === 4014) {
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

    if (!this.state.gateway.sendPayload(makeVoiceStateUpdatePayload(joinConfig2Data(this.joinConfig)))) {

      this.state = {
        ...this.state,
        status: VoiceConnectorStatus.Disconnected,
        reason: DisconnectReason.AdapterUnavailable,
      };
    }

  }

  async waitForState(status: VoiceConnectorStatus, timeoutOrSignal: AbortSignal | number) {
    if (this.#state.status !== status) {

      const [ac, signal] = typeof timeoutOrSignal === 'number'
        ? abortAfter(timeoutOrSignal)
        : [undefined, timeoutOrSignal];

      try {
        await once(this as EventEmitter, status, { signal });
      }
      finally {
        ac?.abort();
      }
    }
  }

  // TODO: This is some how called from PlayerSubscription
	protected onSubscriptionRemoved(subscription: PlayerSubscription) {
		if (this.#state.status !== VoiceConnectorStatus.Destroyed && this.#state.subscription === subscription) {
			this.state = {
				...this.#state,
				subscription: undefined,
			};
		}
	}

  static connect(joinConfig: JoinConfig, adapter: DiscordGatewayAdapter) {
    const payload = makeVoiceStateUpdatePayload(joinConfig2Data(joinConfig));

    // TODO: Get existing connector

    const connector = new VoiceConnector(joinConfig, adapter);

    if (connector.state.status !== VoiceConnectorStatus.Destroyed) {
      connector.state.gateway.sendPayload(payload);
    }

    return connector;
  }
}

type JoinConfig = {
  [K in keyof GatewayVoiceStateUpdateData as CamelCase<K>]: GatewayVoiceStateUpdateData[K]
}

const joinConfig2Data = ({ channelId, guildId, selfDeaf, selfMute }: JoinConfig): GatewayVoiceStateUpdateData => ({
  channel_id: channelId,
  guild_id: guildId,
  self_deaf: selfDeaf,
  self_mute: selfMute
});

function abortAfter(delay: number): [AbortController, AbortSignal] {
	const ac = new AbortController();
	const timeout = setTimeout(() => ac.abort(), delay);
	ac.signal.addEventListener('abort', () => clearTimeout(timeout));
	return [ac, ac.signal];
}
