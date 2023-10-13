import {
  AudienceGroupId,
  createLogger,
  ILogObj,
  IReadonlyLibrary,
  Logger,
  Station
} from "@seamless-medley/core";

import {
  BaseGuildVoiceChannel,
  ChannelType,
  Client,
  Guild,
  GuildBasedChannel,
  GuildMember,
  VoiceBasedChannel,
  VoiceState
} from "discord.js";

import { TrackMessage } from "../trackmessage/types";
import { VoiceConnector, VoiceConnectorStatus } from "../voice/connector";
import { AudioDispatcher, IExciter } from "../../audio/exciter";
import { DiscordAudioPlayer } from "../voice/audio/player";
import { MedleyAutomaton } from "./automaton";

export type GuildStateAdapter = {
  getClient(): Client;
  getChannel(id: string): GuildBasedChannel | undefined;
  getStations(): IReadonlyLibrary<Station>;
  getLogger(): Logger<ILogObj>;
  getAudioDispatcher(): AudioDispatcher;
}

export class GuildState {
  constructor (readonly automaton: MedleyAutomaton, readonly guildId: Guild['id'], readonly adapter: GuildStateAdapter) {
    adapter.getClient().on('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  #logger = createLogger({ name: `guild-state/${this.automaton.id}` })

  dispose() {
    this.adapter.getClient().off('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  preferredStation?: Station;

  #voiceChannelId?: string;

  textChannelId?: string;

  readonly trackMessages: TrackMessage[] = [];

  #serverMuted = false;

  private stationLink?: StationLink;

  private voiceConnector?: VoiceConnector;

  get tunedStation() {
    return this.stationLink?.station;
  }

  get voiceChannelId() {
    return this.#voiceChannelId;
  }

  get serverMuted() {
    return this.#serverMuted;
  }

  hasVoiceConnection() {
    return this.voiceConnector !== undefined;
  }

  hasVoiceChannel() {
    return this.#voiceChannelId !== undefined;
  }

  destroyVoiceConnector(): void {
    this.voiceConnector?.destroy();
    this.voiceConnector = undefined;
  }

  #updateChannelAudiences(channel: VoiceBasedChannel | null | undefined, muted: boolean) {
    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const audienceGroup = this.automaton.makeAudienceGroup(this.guildId);

    if (muted || !channel) {
      station.removeAudiencesForGroup(audienceGroup);
    } else {
      updateStationAudiences(station, audienceGroup, channel);
    }
  }

  #joinedVoiceChannel(channel: VoiceBasedChannel | null | undefined, muted: boolean) {
    this.#voiceChannelId = channel?.id;
    this.#serverMuted = muted;

    this.#updateChannelAudiences(channel, muted);
  }

  #leftVoiceChannel() {
    // if the voiceConnection is defined, meaning the voice state has been forcefully closed
    // if the voiceConnection is undefined here, meaning it might be the result of the `join` command

    if (this.voiceConnector !== undefined) {
      this.detune();
      this.destroyVoiceConnector();
      this.#voiceChannelId = undefined;
    }
  }

  async tune(station: Station): Promise<Station | undefined> {
    this.preferredStation = station;

    const link = await this.createStationLink();

    if (link && this.voiceConnector) {
      link.exciter.addCarrier(this.voiceConnector);
    }

    this.#updateAudiences();

    return link?.station;
  }

  async createStationLink() {
    const { preferredStation, stationLink } = this;

    if (!preferredStation) {
      return stationLink;
    }

    const currentStation = stationLink?.station;

    if (currentStation === preferredStation) {
      return stationLink;
    }

    if (currentStation) {
      this.detune();
    }

    const exciter = DiscordAudioPlayer.make(preferredStation, 256_000, (newExiter) => {
      newExiter.start(this.adapter.getAudioDispatcher());
    });

    const newLink: StationLink = {
      station: preferredStation,
      exciter
    };

    this.stationLink = newLink;

    return newLink;
  }

  async detune() {
    if (!this.stationLink) {
      return;
    }

    const { station, exciter } = this.stationLink;

    if (this.voiceConnector) {
      if (exciter.removeCarrier(this.voiceConnector) <= 0) {
        exciter.stop();
        DiscordAudioPlayer.destroy(exciter);
      }
    }

    station.removeAudiencesForGroup(this.automaton.makeAudienceGroup(this.guildId));

    this.stationLink = undefined;
  }

  async join(channel: BaseGuildVoiceChannel, timeout: number = 5000): Promise<JoinResult> {
    let { stationLink } = this;

    if (!stationLink) {
      // Auto-tuning
      if (!this.preferredStation) {
        const stations = this.adapter.getStations();
        const singleStation = stations.size === 1 ? stations.first() : undefined;

        if (singleStation) {
          this.preferredStation = singleStation;
        }
      }

      // A station was selected
      if (this.preferredStation) {
        stationLink = await this.createStationLink();
      }
    }

    if (!stationLink) {
      return { status: 'no_station' };
    }

    const existingConnection = this.voiceConnector;

    // Release the voiceConnection to make VoiceStateUpdate handler aware of the this join command
    this.voiceConnector = undefined;
    // This is crucial for channel change detection to know about this new joining
    this.#voiceChannelId = undefined;

    // This should be called after setting state.voiceConnection to `undefined`
    existingConnection?.destroy();

    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    let connector: VoiceConnector | undefined = VoiceConnector.connect(
      {
        automatonId: this.automaton.id,
        channelId,
        guildId,
        selfDeaf: true,
        selfMute: false,
      },
      voiceAdapterCreator
    );

    if (!connector) {
      return { status: 'not_joined' };
    }

    try {
      await connector.waitForState(VoiceConnectorStatus.Ready, timeout);
      stationLink.exciter.addCarrier(connector);
    }
    catch (e) {
      connector?.destroy();
      connector = undefined;
      this.voiceConnector = undefined;
      //
      this.adapter.getLogger().error(e);
      throw e;
    }

    this.voiceConnector = connector;

    this.#updateAudiences();

    return { status: 'joined', station: stationLink.station };
  }

  #updateAudiences() {
    if (!this.voiceConnector) {
      return;
    }

    if (!this.voiceChannelId || !this.preferredStation) {
      return;
    }

    const channel = this.adapter.getChannel(this.voiceChannelId);

    if (channel?.type === ChannelType.GuildVoice) {
      updateStationAudiences(
        this.preferredStation,
        this.automaton.makeAudienceGroup(this.guildId),
        channel
      );
    }
  }

  #handleVoiceStateUpdate = (oldState: VoiceState, newState: VoiceState) => {
    if (![newState.guild.id, oldState.guild.id].includes(this.guildId)) {
      return;
    }

    if (!isVoiceStateWithMember(newState)) {
      return;
    }

    const myId = this.adapter.getClient().user?.id;
    const isMe = (newState.member.id === myId);

    if (isMe) {
      this.#handleSelfState(oldState, newState);
    } else {
      this.#handleOthersState(oldState, newState);
    }
  }

  #handleSelfState(oldState: VoiceState, newState: VoiceStateWithMember) {
    if (!this.tunedStation) {
      // Not tuned
      return;
    }

    if (!this.#voiceChannelId) {
      if (newState.channelId) {
        // Just joined
        this.#joinedVoiceChannel(newState.channel, newState.serverMute === true);
      }

      return;
    }

    if (!newState.channelId) {
      // Simply left
      this.#leftVoiceChannel();
      return;
    }

    if (newState.channelId !== oldState.channelId) {
      // Moved by some entity
      this.#joinedVoiceChannel(newState.channel, newState.serverMute === true);
      return;
    }

    // Stationary
    if (oldState.serverMute !== newState.serverMute) {
      this.#serverMuted = newState.serverMute === true;
      this.#updateChannelAudiences(newState.channel, this.#serverMuted);
    }
  }

  #handleOthersState(oldState: VoiceState, newState: VoiceStateWithMember) {
    if (newState.member.user.bot) {
      // Ignoring bot user
      return;
    }

    if (!this.#voiceChannelId) {
      // Me not in a channel, ignoring...
      return;
    }

    if ((this.#voiceChannelId !== oldState.channelId) && (this.#voiceChannelId !== newState.channelId)) {
      // Event occur in another channels
      return;
    }

    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const channel = this.adapter.getChannel(this.#voiceChannelId);
    if (!channel?.isVoiceBased()) {
      return;
    }

    const audienceGroup = this.automaton.makeAudienceGroup(this.guildId);

    if (oldState.channelId !== newState.channelId) {

      if (oldState.channelId === this.#voiceChannelId) {
        // Move away or leave
        station.removeAudience(audienceGroup, newState.member.id);
        return;
      }

      if (newState.channelId === this.#voiceChannelId) {
        // Joined
        if (!this.#serverMuted && !newState.deaf) {
          // Add this audience only if they're not deaf and me is not muted
          station.addAudience(audienceGroup, newState.member.id);
        }

        return;
      }

      return;
    }

    // Stationary, check if is a member
    if (channel.members.has(newState.member.id)) {
      if (oldState.deaf !== newState.deaf) {
        if (newState.deaf === true) {
          // If someone is deafen, he/she is not an audience
          station.removeAudience(audienceGroup, newState.member.id);
        }
        else {
          // If someone is undeafen, he/she become an audience if is in the same channel as the automaton
          if (!this.#serverMuted) {
            station.addAudience(audienceGroup, newState.member.id);
          }
        }
      }
    }
  }
}

export type JoinResult = {
  status: 'no_station' | 'not_joined';
} | {
  status: 'joined';
  station: Station;
}

export type StationLink = {
  station: Station;
  exciter: IExciter;
}

export function updateStationAudiences(station: Station, groupId: AudienceGroupId, channel: VoiceBasedChannel) {
  station.updateAudiences(
    groupId,
    channel.members
      .filter(member => !member.user.bot && !member.voice.deaf)
      .map(member => member.id)
  );
}

interface VoiceStateWithMember extends VoiceState {
  get member(): GuildMember;
}

function isVoiceStateWithMember(s: VoiceState): s is VoiceStateWithMember {
  return s.member !== null;
}
