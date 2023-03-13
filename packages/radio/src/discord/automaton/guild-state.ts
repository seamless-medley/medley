import {
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

  dispose() {
    this.adapter.getClient().off('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  preferredStation?: Station;

  /**
   * @deprecated
   */
  #gain = 1.0;

  #voiceChannelId?: string;

  textChannelId?: string;

  readonly trackMessages: TrackMessage[] = [];

  #serverMuted = false;

  private stationLink?: StationLink;

  private voiceConnector?: VoiceConnector;

  get tunedStation() {
    return this.stationLink?.station;
  }

  /**
   * @deprecated
   */
  get gain() {
    return this.#gain;
  }

  /**
   * @deprecated
   */
  set gain(value: number) {
    this.#gain = value;
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

  destroyVoiceConnection() {
    if (this.voiceConnector === undefined) {
      return false;
    }

    this.voiceConnector.destroy();
    this.voiceConnector = undefined;

    return true;
  }

  joinedVoiceChannel(voiceChannelId: string | undefined, muted: boolean) {
    this.#voiceChannelId = voiceChannelId;
    this.#serverMuted = muted;
  }

  leftVoiceChannel() {
    // if the voiceConnection is defined, meaning the voice state has been forcefully closed
    // if the voiceConnection is undefined here, meaning it might be the result of the `join` command

    if (this.destroyVoiceConnection()) {
      this.detune();
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

    // const exciter = new DiscordAudioPlayer(preferredStation, this.adapter.getInitialGain());
    const exciter = DiscordAudioPlayer.make(preferredStation);

    this.adapter.getAudioDispatcher().add(exciter);
    exciter.start();

    const newLink: StationLink = {
      station: preferredStation,
      exciter: exciter
    };

    this.stationLink = newLink;
    this.gain = 1.0;

    return newLink;
  }

  async detune() {
    if (!this.stationLink) {
      return;
    }

    const { station, exciter } = this.stationLink;

    if (this.voiceConnector) {
      exciter.removeCarrier(this.voiceConnector);
    }

    exciter.stop();

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
      updateStationAudiences(this.automaton, this.preferredStation, channel);
    }
  }

  #handleVoiceStateUpdate = (oldState: VoiceState, newState: VoiceState) => {
    if (newState.guild.id !== this.guildId) {
      return;
    }

    const channelChange = detectVoiceChannelChange(oldState, newState);
    if (channelChange === 'invalid' || !isVoiceStateWithMember(newState)) {
      return;
    }

    const myId = this.adapter.getClient().user?.id;
    const isMe = (newState.member.id === myId);

    if (isMe) {
      this.#handleSelfState(oldState, newState, channelChange);
    } else {
      this.#handleOthersState(oldState, newState, channelChange);
    }
  }

  #handleSelfState(oldState: VoiceState, newState: VoiceStateWithMember, channelChange: ValidChannelChange | undefined) {
    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const audienceGroup = this.automaton.makeAudienceGroup(this.guildId);

    if (channelChange === 'leave') {
      // Me Leaving,
      this.leftVoiceChannel();
      return;
    }

    if (newState.channelId !== this.voiceChannelId) {
      // Me Just joined or moved, collecting...
      this.joinedVoiceChannel(newState.channelId || undefined, newState.serverMute === true)

      if (station && this.voiceConnector?.state.status === VoiceConnectorStatus.Ready) {

        if (newState.serverMute) {
          station.removeAudiencesForGroup(audienceGroup);
        } else {
          updateStationAudiences(this.automaton, station, newState.channel!);
        }
      }

      return;
    }

    if (oldState.serverMute !== newState.serverMute) {
      this.#serverMuted = !!newState.serverMute;

      if (station) {
        if (this.#serverMuted) {
          station.removeAudiencesForGroup(audienceGroup);
        } else {
          updateStationAudiences(this.automaton, station, newState.channel!);
        }
      }
    }
  }

  #handleOthersState(oldState: VoiceState, newState: VoiceStateWithMember, channelChange: ValidChannelChange | undefined) {
    if (newState.member.user.bot) {
      // Ignoring bot user
      return;
    }

    if (!this.hasVoiceChannel()) {
      // Me not in a room, ignoring...
      return;
    }

    if (this.#serverMuted) {
      return;
    }

    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const myId = this.adapter.getClient().user?.id;
    const audienceGroup = this.automaton.makeAudienceGroup(this.guildId);

    // state change is originated from other member that is in the same room as me.
    if (channelChange === 'leave') {
      if (oldState.channelId !== this.voiceChannelId) {
        // is not leaving my channel
        return;
      }

      station.removeAudience(audienceGroup, newState.member.id);
      return;
    }

    if (channelChange === 'join' || channelChange === 'move') {

      // this newState is for our channel
      if (newState.channelId === this.voiceChannelId) {

        // Check if the bot is actually in this channel
        const channel = this.adapter.getChannel(newState.channelId);
        if (channel?.isVoiceBased() && myId) {
          if (!channel.members.has(myId)) {
            return;
          }
        }

        if (!newState.deaf) {
          // User has joined or moved into
          station.addAudience(audienceGroup, newState.member.id);
        }

        return;
      }

      // User has moved away
      if (oldState.channelId === this.voiceChannelId) {
        station.removeAudience(audienceGroup, newState.member.id);
        return;
      }

      // is joining or moving to other channel
      return;
    }

    // No channel change but deaf state change
    if (oldState.deaf !== newState.deaf && newState.channelId === this.voiceChannelId) {
      if (newState.deaf === true) {
        station.removeAudience(audienceGroup, newState.member.id);
      } else {
        station.addAudience(audienceGroup, newState.member.id);
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

export function updateStationAudiences(automaton: MedleyAutomaton, station: Station, channel: VoiceBasedChannel) {
  station.updateAudiences(
    automaton.makeAudienceGroup(channel.guildId),
    channel.members
      .filter(member => !member.user.bot && !channel.guild.voiceStates.cache.get(member.id)?.deaf)
      .map(member => [member.id, undefined])
  );
}

interface VoiceStateWithMember extends VoiceState {
  get member(): GuildMember;
}

function isVoiceStateWithMember(s: VoiceState): s is VoiceStateWithMember {
  return s.member !== null;
}

type ChannelChange = 'join' | 'leave' | 'move' | 'invalid';

type ValidChannelChange = Exclude<ChannelChange, 'invalid'>;

export function detectVoiceChannelChange(oldState: VoiceState, newState: VoiceState): ChannelChange | undefined {
  if (!oldState.channelId && !newState.channelId) {
    // Doesn't make any sense
    return 'invalid';
  }

  if (!oldState.channelId) {
    return 'join'
  }

  if (!newState.channelId) {
    return 'leave';
  }

  return oldState.channelId !== newState.channelId ? 'move' : undefined;
}

