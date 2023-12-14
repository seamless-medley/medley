import {
  AudienceGroupId,
  IReadonlyLibrary,
  Station
} from "@seamless-medley/core";

import { retryable } from "@seamless-medley/utils";
import { Logger } from "@seamless-medley/logging";

import {
  BaseGuildVoiceChannel,
  ChannelType,
  Client,
  Guild,
  GuildBasedChannel,
  GuildMember,
  PermissionsBitField,
  VoiceBasedChannel,
  VoiceState
} from "discord.js";

import { TrackMessage } from "../trackmessage/types";
import { VoiceConnector, VoiceConnectorStatus } from "../voice/connector";
import { AudioDispatcher, ICarriableExciter } from "../../audio/exciter";
import { DiscordAudioPlayer } from "../voice/audio/player";
import { GuildSpecificConfig, MedleyAutomaton } from "./automaton";
import { TrackMessageCreator } from "../trackmessage/creator/base";
import { makeCreator } from "../trackmessage/creator";

export type GuildStateAdapter = {
  getAutomaton(): MedleyAutomaton;
  getClient(): Client;
  getChannel(id: string): GuildBasedChannel | undefined;
  getStations(): IReadonlyLibrary<Station>;
  getLogger(): Logger;
  getAudioDispatcher(): AudioDispatcher;
  getConfig(guildId: string): GuildSpecificConfig | undefined;
  makeAudienceGroup(guildId: string): AudienceGroupId;
}

export class GuildState {
  constructor (readonly guildId: Guild['id'], readonly adapter: GuildStateAdapter) {
    adapter.getClient().on('voiceStateUpdate', this.#handleVoiceStateUpdate);

    const config = adapter.getConfig(guildId);
    this.textChannelId = config?.trackMessage?.channel;
  }

  dispose() {
    this.adapter.getClient().off('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  preferredStation?: Station;

  #voiceChannelId?: string;

  textChannelId?: string;

  #trackMessageCreator?: TrackMessageCreator;

  readonly trackMessages: TrackMessage[] = [];

  #serverMuted = false;

  private stationLink?: StationLink;

  #voiceConnector?: VoiceConnector;

  get maxTrackMessages() {
    const config = this.adapter.getConfig(this.guildId);
    return config?.trackMessage?.max || 3;
  }

  get trackMessageCreator(): TrackMessageCreator {
    const type = this.adapter.getConfig(this.guildId)?.trackMessage?.type || 'extended';

    if (this.#trackMessageCreator?.name !== type) {
      this.#trackMessageCreator = makeCreator(type);
    }

    return this.#trackMessageCreator;
  }

  get tunedStation() {
    return this.stationLink?.station;
  }

  get voiceChannelId() {
    return this.#voiceChannelId;
  }

  get serverMuted() {
    return this.#serverMuted;
  }

  get bitrate() {
    return this.stationLink?.exciter?.bitrate ?? 0;
  }

  set bitrate(newBitrate: number) {
    if (this.stationLink?.exciter) {
      this.stationLink.exciter.bitrate = newBitrate;
    }
  }

  hasVoiceConnection() {
    return this.#voiceConnector !== undefined;
  }

  hasVoiceChannel() {
    return this.#voiceChannelId !== undefined;
  }

  destroyVoiceConnector(): void {
    this.#voiceConnector?.destroy();
    this.#voiceConnector = undefined;
  }

  #updateChannelAudiences(channel: VoiceBasedChannel | null | undefined, muted: boolean) {
    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const audienceGroup = this.adapter.makeAudienceGroup(this.guildId);

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

    if (this.#voiceConnector !== undefined) {
      this.detune();
      this.destroyVoiceConnector();
      this.#voiceChannelId = undefined;
    }
  }

  async tune(station: Station): Promise<Station | undefined> {
    this.preferredStation = station;

    const { guildId, adapter, stationLink } = this;
    const oldStation = stationLink?.station;

    const link = await this.createStationLink();

    if (link && this.#voiceConnector) {
      link.exciter.addCarrier(this.#voiceConnector);
    }

    this.#updateAudiences();

    const newStation = link?.station;

    if (newStation) {
      adapter.getAutomaton().emit('stationTuned', guildId, oldStation, newStation);
    }

    return newStation;
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

    const bitrate = (this.adapter.getConfig(this.guildId)?.bitrate ?? 256) * 1000;
    const exciter = DiscordAudioPlayer.make(preferredStation, bitrate , (newExiter) => {
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

    if (this.#voiceConnector) {
      if (exciter.removeCarrier(this.#voiceConnector) <= 0) {
        exciter.stop();
        DiscordAudioPlayer.destroy(exciter);
      }
    }

    station.removeAudiencesForGroup(this.adapter.makeAudienceGroup(this.guildId));

    this.stationLink = undefined;
  }

  async join(channel: BaseGuildVoiceChannel, timeout: number = 5000, retries: number = 0): Promise<JoinResult> {
    const { me } = channel.guild.members;

    const granted = me && channel.permissionsFor(me).has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])

    if (!granted) {
      return { status: 'not_granted' }
    }

    let { stationLink } = this;

    if (!stationLink) {
      // Auto-tuning
      if (!this.preferredStation) {
        const config = this.adapter.getConfig(channel.guildId);
        const stations = this.adapter.getStations();

        if (config?.autotune) {
          this.preferredStation = stations.get(config?.autotune);
        }

        if (!this.preferredStation) {
          const singleStation = stations.size === 1 ? stations.first() : undefined;

          if (singleStation) {
            this.preferredStation = singleStation;
          }
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

    const existingConnection = this.#voiceConnector;

    // Release the voiceConnection to make VoiceStateUpdate handler aware of the this join command
    this.#voiceConnector = undefined;
    // This is crucial for channel change detection to know about this new joining
    this.#voiceChannelId = undefined;

    // This should be called after setting state.voiceConnection to `undefined`
    existingConnection?.destroy();

    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    let connector: VoiceConnector | undefined = VoiceConnector.connect(
      {
        automatonId: this.adapter.getAutomaton().id,
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
      const conn = connector;
      const link = stationLink;

      const result = await retryable<JoinResult>(async() => {
        await conn.waitForState(VoiceConnectorStatus.Ready, timeout);

        link.exciter.addCarrier(conn);
        this.#voiceConnector = conn;

        this.#updateAudiences();

        return { status: 'joined', station: stationLink!.station };
      }, { retries, wait: 1000 });

      if (result === undefined) {
        throw new Error('Aborted');
      }

      return result;
    }
    catch (e) {
      connector?.destroy();
      connector = undefined;
      this.#voiceConnector = undefined;
      //
      this.adapter.getLogger().error(e);
      return { status: 'not_joined' };
    }
  }

  #updateAudiences() {
    if (!this.#voiceConnector) {
      return;
    }

    if (!this.voiceChannelId || !this.preferredStation) {
      return;
    }

    const channel = this.adapter.getChannel(this.voiceChannelId);

    if (channel?.type === ChannelType.GuildVoice) {
      updateStationAudiences(
        this.preferredStation,
        this.adapter.makeAudienceGroup(this.guildId),
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

    const audienceGroup = this.adapter.makeAudienceGroup(this.guildId);

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
  status: 'no_station' | 'not_granted' | 'not_joined';
} | {
  status: 'joined';
  station: Station;
}

export type StationLink = {
  station: Station;
  exciter: ICarriableExciter;
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
