import { AudioPlayer, AudioResource, createAudioPlayer, entersState, joinVoiceChannel, NoSubscriberBehavior, PlayerSubscription, VoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import { AudienceGroupId, AudienceType, ILogObj, IReadonlyLibrary, Logger, makeAudienceGroup as makeStationAudienceGroup, RequestAudioStreamResult, Station } from "@seamless-medley/core";
import { BaseGuildVoiceChannel, ChannelType, Client, Guild, GuildBasedChannel, GuildMember, VoiceBasedChannel, VoiceState } from "discord.js";
import { createExciter } from "./exciter";
import { TrackMessage } from "../trackmessage/types";
import { voiceConnectionKeepAlivePatch } from "../voice/patch";

const makeAudienceGroup = (id: string): AudienceGroupId => makeStationAudienceGroup(AudienceType.Discord, id);

export type GuildStateAdapter = {
  getClient(): Client;
  getChannel(id: string): GuildBasedChannel | undefined;
  getStations(): IReadonlyLibrary<Station>;
  getLogger(): Logger<ILogObj>;
  getInitialGain(): number;
}

export class GuildState {
  constructor (readonly guildId: Guild['id'], readonly adapter: GuildStateAdapter) {

    adapter.getClient().on('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  dispose() {
    this.adapter.getClient().off('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  preferredStation?: Station;

  #gain = 1.0;

  #voiceChannelId?: string;

  textChannelId?: string;

  readonly trackMessages: TrackMessage[] = [];

  #serverMuted = false;

  private stationLink?: StationLink;

  private voiceConnection?: VoiceConnection;

  #playerSubscription?: PlayerSubscription;

  get tunedStation() {
    return this.stationLink?.station;
  }

  get gain() {
    return this.#gain;
  }

  set gain(value: number) {
    this.#gain = value;

    if (this.stationLink) {
      const { station, audioRequest } = this.stationLink;
      station.medley.updateAudioStream(audioRequest.id, { gain: value });
    }
  }

  get voiceChannelId() {
    return this.#voiceChannelId;
  }

  get serverMuted() {
    return this.#serverMuted;
  }

  hasVoiceConnection() {
    return this.voiceConnection !== undefined;
  }

  hasVoiceChannel() {
    return this.#voiceChannelId !== undefined;
  }

  destroyVoiceConnection() {
    this.voiceConnection?.destroy();
    this.voiceConnection = undefined;
  }

  joinedVoiceChannel(voiceChannelId: string | undefined, muted: boolean) {
    this.#voiceChannelId = voiceChannelId;
    this.#serverMuted = muted;
  }

  leftVoiceChannel() {
    this.detune();

    // if the voiceConnection is defined, meaning the voice state has been forcefully closed
    // if the voiceConnection is undefined here, meaning it might be the result of the `join` command

    this.destroyVoiceConnection();
    this.#voiceChannelId = undefined;
  }

  async tune(station: Station): Promise<Station | undefined> {
    this.preferredStation = station;

    const link = await this.createStationLink();

    if (link) {
      this.playerSubscription = this.voiceConnection?.subscribe(link.audioPlayer);
    }

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

    const requestedAudioStream = await preferredStation.requestAudioStream({
      bufferSize: 48000 * 2.5, // This should be large enough to hold PCM data while waiting for node stream to comsume
      buffering: 960, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
      preFill: 48000 * 0.5, // Pre-fill the stream with at least 500ms of audio, to reduce stuttering while encoding to Opus
      // discord voice only accept 48KHz sample rate, 16 bit per sample
      sampleRate: 48000,
      format: 'Int16LE',
      gain: this.adapter.getInitialGain()
    })

    const exciter = createExciter({
      source: requestedAudioStream,
      bitrate: 256_000
    });

    const audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 1000
      }
    });

    audioPlayer.play(exciter);

    const newLink: StationLink = {
      station: preferredStation,
      audioPlayer,
      audioResource: exciter,
      audioRequest: exciter.metadata
    };

    if (this.voiceConnection) {
      if (this.voiceChannelId) {
        const channel = this.adapter.getChannel(this.voiceChannelId);

        if (channel?.type === ChannelType.GuildVoice) {
          updateStationAudiences(preferredStation, channel);
        }
      }
    }

    this.stationLink = newLink;
    this.gain = this.adapter.getInitialGain();

    return newLink;
  }

  async detune() {
    if (!this.stationLink) {
      return;
    }

    const { station, audioRequest, audioPlayer } = this.stationLink;

    this.playerSubscription = undefined;

    audioPlayer.stop(true);

    station.medley.deleteAudioStream(audioRequest.id);
    station.removeAudiencesForGroup(makeAudienceGroup(this.guildId));

    this.stationLink = undefined;
  }

  get playerSubscription() {
    return this.#playerSubscription;
  }

  set playerSubscription(value: PlayerSubscription | undefined) {
    this.#playerSubscription?.unsubscribe();
    this.#playerSubscription = value;
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

      // A station was selected, but no stationLink presented
      if (this.preferredStation) {
        stationLink = await this.createStationLink();
      }
    }

    if (!stationLink) {
      return { status: 'no_station' };
    }

    const existingConnection = this.voiceConnection;
    // Release the voiceConnection to make VoiceStateUpdate handler aware of the this join command
    this.voiceConnection = undefined;

    // This should be called after setting state.voiceConnection to `undefined`
    existingConnection?.destroy();

    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    let voiceConnection: VoiceConnection | undefined = voiceConnectionKeepAlivePatch(joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator
    }));

    if (!voiceConnection) {
      return { status: 'not_joined' };
    }

    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, timeout);
      this.playerSubscription = voiceConnection.subscribe(stationLink.audioPlayer);
    }
    catch (e) {
      voiceConnection?.destroy();
      voiceConnection = undefined;
      this.voiceConnection = undefined;
      this.playerSubscription = undefined;
      //
      this.adapter.getLogger().error(e);
      throw e;
    }

    this.voiceConnection = voiceConnection;

    return { status: 'joined', station: stationLink.station };
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

    const audienceGroup = makeAudienceGroup(this.guildId);

    if (channelChange === 'leave') {
      // Me Leaving,
      this.leftVoiceChannel();
      return;
    }

    if (newState.channelId !== this.voiceChannelId) {
      // Me Just joined or moved, collecting...
      this.joinedVoiceChannel(newState.channelId || undefined, newState.serverMute === true)

      if (station) {
        if (this.#serverMuted) {
          station.removeAudiencesForGroup(audienceGroup);
        } else {
          updateStationAudiences(station, newState.channel!);
        }
      }

      return;
    }

    if (oldState.serverMute != newState.serverMute) {

      this.#serverMuted = !!newState.serverMute;

      if (station) {
        if (this.#serverMuted) {
          station.removeAudiencesForGroup(audienceGroup);
        } else {
          updateStationAudiences(station, newState.channel!);
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
    const audienceGroup = makeAudienceGroup(this.guildId);

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
          station.addAudiences(audienceGroup, newState.member.id);
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
      if (!newState.deaf) {
        station.addAudiences(audienceGroup, newState.member.id);
      } else {
        station.removeAudience(audienceGroup, newState.member.id);
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
  audioRequest: RequestAudioStreamResult;
  audioResource: AudioResource<RequestAudioStreamResult>;
  audioPlayer: AudioPlayer;
}

export function updateStationAudiences(station: Station, channel: VoiceBasedChannel) {
  station.updateAudiences(
    makeAudienceGroup(channel.guildId),
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

