import { clamp, noop, sortBy, take, uniq } from "lodash";

import {
  AudienceGroupId,
  IReadonlyLibrary,
  KaraokeUpdateParams,
  Station,
  getStationTrackSorters,
} from "@seamless-medley/core";

import { retryable } from "@seamless-medley/utils";
import { Logger } from "@seamless-medley/logging";

import {
  ActionRowBuilder,
  BaseGuildVoiceChannel,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  GuildBasedChannel,
  GuildMember,
  Message,
  MessageActionRowComponentBuilder,
  MessageReplyOptions,
  PermissionsBitField,
  VoiceBasedChannel,
  VoiceState,
  hyperlink,
  quote
} from "discord.js";

import { TrackMessage } from "../trackmessage/types";
import { VoiceConnector, VoiceConnectorStatus } from "../voice/connector";
import { AudioDispatcher } from "../../audio/exciter";
import { DiscordAudioPlayer } from "../voice/audio/player";
import { GuildSpecificConfig, MedleyAutomaton } from "./automaton";
import { TrackMessageCreator } from "../trackmessage/creator/base";
import { makeCreator } from "../trackmessage/creator";
import { createCoverImageAttachment } from "../helpers/message";
import { extractSpotifyUrl, fetchSpotifyInfo, formatSpotifyField } from "../helpers/spotify";

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
    this.#gain = clamp(config?.gain ?? 1.0, 0, 1);
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

  #karaokeEnabled = false;

  #gain = 1.0;

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

  get gain() {
    return this.#gain;
  }

  set gain(newGain: number) {
    newGain = clamp(newGain, 0, 1);
    if (newGain !== this.#gain) {
      this.#gain = newGain;
      this.stationLink?.exciter?.setGain(newGain);
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

  /**
   * Just joined a voice channel, audiences for this guild should be reset to this channel's members
   */
  #joinedVoiceChannel(channel: VoiceBasedChannel | null | undefined, muted: boolean) {
    this.#voiceChannelId = channel?.id;
    this.#serverMuted = muted;

    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const audienceGroup = this.adapter.makeAudienceGroup(this.guildId);

    if (muted || !channel) {
      station.removeAudiencesForGroup(audienceGroup);
      return;
    }

    station.updateAudiences(
      audienceGroup,
      channel.members
        .filter(member => !member.user.bot && !member.voice.deaf)
        .map(member => member.id)
    );
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
    const { guildId, adapter, stationLink: oldLink } = this;

    this.preferredStation = station;
    const newLink = await this.createStationLink();

    if (newLink && this.#voiceConnector) {
      if (!newLink.exciter.started) {
        await newLink.exciter.start(this.adapter.getAudioDispatcher());
      }

      newLink.exciter.addCarrier(this.#voiceConnector);
    }

    this.#updateAudiences();

    const newStation = newLink?.station;

    if (newStation) {
      adapter.getAutomaton().emit('stationTuned', guildId, oldLink?.station, newStation);
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

    const config = this.adapter.getConfig(this.guildId);
    const bitrate = (config?.bitrate ?? 256) * 1000;
    const exciter = new DiscordAudioPlayer(preferredStation, {
      gain: this.#gain,
      bitrate
    });
    this.#karaokeEnabled = false;

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

        if (!link.exciter.started) {
          await link.exciter.start(this.adapter.getAudioDispatcher());
        }

        link.exciter.addCarrier(conn);
        this.#voiceConnector = conn;

        this.#updateAudiences();

        return { status: 'joined', station: stationLink!.station };
      }, { retries, wait: 1000, factor: 1 });

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

    if ((channel?.type === ChannelType.GuildVoice) || (channel?.type === ChannelType.GuildStageVoice)) {
      this.preferredStation.updateAudiences(
        this.adapter.makeAudienceGroup(this.guildId),
        channel.members
          .filter(member => !member.user.bot && !member.voice.deaf)
          .map(member => member.id)
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
        this.#joinedVoiceChannel(newState.channel, isVoiceStateMuted(newState));
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
      this.#joinedVoiceChannel(newState.channel, isVoiceStateMuted(newState));
      return;
    }

    // Stationary
    if (isVoiceStateMuted(oldState) !== isVoiceStateMuted(newState)) {
      this.#serverMuted = isVoiceStateMuted(newState);
      this.#serverMuteStateChanged(newState.channel);
    }
  }

  #serverMuteStateChanged(channel: VoiceBasedChannel | null) {
    const station = this.tunedStation;

    if (!station) {
      return;
    }

    const audienceGroup = this.adapter.makeAudienceGroup(this.guildId);

    if (this.#serverMuted || !channel) {
      station.removeAudiencesForGroup(audienceGroup);
      return;
    }

    const updateAudience = !this.#serverMuted
      ? ((member: GuildMember) => {
        if (!member.user.system && !member.user.bot && !member.voice.deaf) {
          station.addAudience(audienceGroup, member.id);
        }
      })
      : (mmeber: GuildMember) => station.removeAudience(audienceGroup, mmeber.id)

    channel.members.forEach(updateAudience);

    // Remove invalid audiences, any audience that does not belong to this channel
    const audiences = station.getAudiences(audienceGroup);
    if (audiences) {
      for (const memberId of audiences) {
        if (!channel.members.has(memberId)) {
          station.removeAudience(audienceGroup, memberId);
        }
      }
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

  setKaraokeParams(params: KaraokeUpdateParams): boolean {
    if (!this.stationLink?.exciter) {
      return false;
    }

    if (params.enabled !== undefined) {
      this.#karaokeEnabled = params.enabled;
    }

    if (this.stationLink.station.isInTransition) {
      if (params.enabled) {
        params.enabled = false;
      }
    }

    return this.stationLink.exciter.setKaraokeParams(params);
  }

  temporarilyDisableKaraoke(): boolean {
    if (!this.stationLink?.exciter) {
      return false;
    }

    if (!this.#karaokeEnabled) {
      return false;
    }

    return this.stationLink.exciter.setKaraokeParams({ enabled: false });
  }

  restoreKaraoke(): boolean {
    if (!this.stationLink?.exciter) {
      return false;
    }

    return this.stationLink.exciter.setKaraokeParams({ enabled: this.#karaokeEnabled });
  }

  get karaokeEnabled() {
    return this.#karaokeEnabled;
  }

  async handleIncomingMessage(message: Message<true>) {
    this.#handleSpotifyUrl(message);
  }

  async #handleSpotifyUrl(message: Message<true>) {
    const station = this.tunedStation;
    if (!station) {
      return;
    }

    const isOwnerOverride = this.adapter.getAutomaton().owners.includes(message.author.id);

    const shouldCheckAudiences = !isOwnerOverride && this.adapter.getConfig(message.guildId)?.trackMessage?.always !== true;

    if (shouldCheckAudiences) {
      const audiences = station.getAudiences(this.adapter.makeAudienceGroup(this.guildId));

      if (!audiences?.has(message.author.id)) {
        return;
      }
    }

    const createReply = async (url: URL, [type, id]: [string, string]): Promise<MessageReplyOptions | undefined> => {
      const searchKey = `spotify:${type}`;

      if (!['track', 'artist'].includes(type)) {
        return;
      }

      const info = await retryable(async () => fetchSpotifyInfo(url.href), { retries: 2, wait: 1 })

      switch (type) {
        case 'track': {
          if (info?.type !== 'track' || !info.title) {
            return;
          }

          const dedicatedTracks = await station.findTracksByComment(searchKey, id);

          const [track] = sortBy(dedicatedTracks, ...getStationTrackSorters(station));

          if (track) {
            const { id: trackId, extra } = track;

            const { title = info.title || 'Unknown', artist = info.artist || 'Unknown' } = extra?.tags ?? {};

            const embed = new EmbedBuilder();

            if (info.image) {
              embed.setThumbnail(info.image);
            }

            embed
              .setTitle('Found a dedicated track for this link')
              .addFields(
                { name: 'Title', value: quote(formatSpotifyField('title', title, id)) },
                { name: 'Artist', value: quote(info.artist_url ? hyperlink(artist, info.artist_url) : artist) },
              )

            if (!embed.data.thumbnail) {
              const cover = await createCoverImageAttachment(track);
              if (cover) {
                embed.setThumbnail(cover.url);
              }
            }

            return {
              embeds: [embed],
              components: [
                new ActionRowBuilder<MessageActionRowComponentBuilder>()
                  .addComponents(
                    new ButtonBuilder()
                      .setLabel('Make a request')
                      .setStyle(ButtonStyle.Primary)
                      .setCustomId(`request:track:${trackId}`)
                  )
              ]
            }
          }

          // Search and show the potentials
          const searchResult = await station.search({
            q: {
              title: info.title,
              artist: info.artist
            },
            noHistory: true
          });

          if (searchResult.length) {
            return {
              embeds: [new EmbedBuilder()
                .setTitle(`Found ${searchResult.length} potential track(s) for this title`)
              ],
              components: [
                new ActionRowBuilder<MessageActionRowComponentBuilder>()
                  .addComponents(
                    new ButtonBuilder()
                      .setLabel('Search')
                      .setStyle(ButtonStyle.Primary)
                      .setCustomId(`request:cross_search:${id}`)
                  )
              ]
            }
          }

          break;
        }

        case 'artist': {
          if (info?.type !== 'artist' || !info.artist) {
            return;
          }

          const embed = new EmbedBuilder();

          if (info.image) {
            embed.setThumbnail(info.image);
          }

          const exactMatches = await station.findTracksByComment(
            searchKey,
            id,
            {
              sort: { title: 1 },
              valueDelimiter: ','
            }
          );

          const exactIds = new Set(exactMatches.map(t => t.id));

          const searchResult = await station.search({
              q: { artist: info.artist },
              fuzzy: 'exact',
              noHistory: true
            })
            .then(s => s.filter(t => !exactIds.has(t.id)));

          if (exactMatches.length + searchResult.length) {
            const exactMatchBanners = uniq(exactMatches.map(getTrackBanner));
            const searchResultBanners = uniq(searchResult.map(getTrackBanner));

            const counter = [
                exactMatchBanners.length ? `${exactMatchBanners.length} track(s)` : undefined,
                searchResultBanners.length ? `${searchResultBanners.length} potential track(s)` : undefined
              ]
              .filter((s): s is string => s !== undefined)
              .join(' and ');

            embed
              .setTitle(`Found ${counter} for this artist`)
              .addFields(
                { name: 'Artist', value: quote(hyperlink(info.artist, url.href)) },
              )

            return {
              embeds: [embed],
              components: [
                new ActionRowBuilder<MessageActionRowComponentBuilder>()
                  .addComponents(
                    new ButtonBuilder()
                      .setLabel('Search')
                      .setStyle(ButtonStyle.Primary)
                      .setCustomId(`request:artist_search:${id}`)
                  )
              ]
            }
          }

          break;
        }

        default:
          return;
      }
    }

    const matches = extractSpotifyUrl(message.content);

    for (const match of matches.slice(0, 3)) {
      const reply = await createReply(match.url, match.paths);

      if (reply) {
        message.reply(reply).catch(noop);
      }
    }

    if (matches.length > 3) {
      message.reply(`‼️ Up to 3 Spotify links can be used at a time`);
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
  exciter: DiscordAudioPlayer;
}

interface VoiceStateWithMember extends VoiceState {
  get member(): GuildMember;
}

function isVoiceStateWithMember(s: VoiceState): s is VoiceStateWithMember {
  return s.member !== null;
}

function isVoiceStateMuted(s: VoiceState) {
  return (s.suppress || s.serverMute) === true;
}
