import { clamp, first, noop, sortBy, take, uniq } from "lodash";

import {
  AudienceGroupId,
  IReadonlyLibrary,
  Station,
  getStationTrackSorters,
  getTrackBanner,
} from "../../core";

import { AbortRetryError, formatDuration, retryable } from "@seamless-medley/utils";
import { type Logger } from "../../logging";

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
  inlineCode,
  quote
} from "discord.js";

import { detectAll as detectLanguages } from 'tinyld';

import { TrackMessage } from "../trackmessage/types";
import { getVoiceConnector, VoiceConnector, VoiceConnectorStatus } from "../voice/connector";
import { AudioDispatcher } from "../../audio/exciter";
import { DiscordAudioPlayer } from "../voice/audio/player";
import { GuildSpecificConfig, MedleyAutomaton } from "./automaton";
import { TrackMessageCreator } from "../trackmessage/creator/base";
import { makeCreator } from "../trackmessage/creator";
import { createCoverImageAttachment } from "../helpers/message";
import { extractSpotifyUrl, fetchSpotifyInfo, formatSpotifyField } from "../helpers/spotify";
import type { KaraokeUpdateParams } from "@seamless-medley/medley";

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

type DesignatedVoiceChannel = {
  channelId: string;
  timestamp: number;
}

export class GuildState {
  constructor (readonly guildId: Guild['id'], adapter: GuildStateAdapter) {
    this.#adapter = adapter;

    adapter.getClient().on('voiceStateUpdate', this.#handleVoiceStateUpdate);

    const config = adapter.getConfig(guildId);
    this.#gain = clamp(config?.gain ?? 1.0, 0, 1);
    this.textChannelId = config?.trackMessage?.channel;
  }

  dispose() {
    this.#adapter.getClient().off('voiceStateUpdate', this.#handleVoiceStateUpdate);
  }

  #adapter: GuildStateAdapter;

  #preferredStation?: Station;

  /**
   * The designated voice channel
   *
   */
  #designatedVC?: DesignatedVoiceChannel;

  /**
   * The currently joined voice channel
   */
  #voiceChannelId?: string;

  textChannelId?: string;

  #trackMessageCreator?: TrackMessageCreator;

  readonly #trackMessages: TrackMessage[] = [];

  #serverMuted = false;

  #stationLink?: StationLink;

  #rejoinAC?: AbortController;

  #karaokeEnabled = false;

  #gain = 1.0;

  #checkVCTimer?: NodeJS.Timeout;

  get #automaton() {
    return this.#adapter.getAutomaton();
  }

  get stationLink() {
    return this.#stationLink;
  }

  get trackMessages() {
    return this.#trackMessages;
  }

  get maxTrackMessages() {
    const config = this.#adapter.getConfig(this.guildId);
    return config?.trackMessage?.max || 3;
  }

  get trackMessageCreator(): TrackMessageCreator {
    const type = this.#adapter.getConfig(this.guildId)?.trackMessage?.type || 'extended';

    if (this.#trackMessageCreator?.name !== type) {
      this.#trackMessageCreator = makeCreator(type, this.#automaton);
    }

    return this.#trackMessageCreator;
  }

  get preferredStation() {
    return this.#preferredStation;
  }

  set preferredStation(newStation) {
    this.#preferredStation = newStation;
  }

  get tunedStation() {
    return this.stationLink?.station;
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

  get voiceChannelId() {
    return this.#voiceChannelId;
  }

  hasVoiceChannel() {
    return this.#voiceChannelId !== undefined;
  }

  #getVoiceConnector() {
    return getVoiceConnector(this.#automaton.id, this.guildId);
  }

  /**
   * Just joined a voice channel, audiences for this guild should be reset to this channel's members
   */
  async #joinedVoiceChannel(channel: VoiceBasedChannel, muted: boolean) {
    this.#serverMuted = muted;
    this.#voiceChannelId = channel.id;

    const station = this.tunedStation;

    if (!station) {
      return;
    }

    return new Promise<void>((resolve) => {
      const connector = this.#getVoiceConnector();

      if (connector === undefined) {
        resolve();
        return;
      }

      const setDesignatedVC = () => {
        this.#designatedVC = {
          channelId: channel.id,
          timestamp: Date.now()
        }

        if (muted) {
          const audienceGroup = this.#adapter.makeAudienceGroup(this.guildId);
          station.removeAudiencesForGroup(audienceGroup);
        }

        this.#updateAudiences('voice connector become ready');

        resolve();
      }

      if (connector.isReady) {
        setDesignatedVC();
        return;
      }

      connector.once(VoiceConnectorStatus.Ready, setDesignatedVC);
    });
  }

  #leftVoiceChannel() {
    const connector = this.#getVoiceConnector();

    this.detune();

    connector?.destroy();
    this.#designatedVC = undefined;
    this.#voiceChannelId = undefined;
  }


  disconnectedFromVoiceChannel() {
    this.#voiceChannelId = undefined;
  }

  async tune(station: Station): Promise<Station | undefined> {
    const { guildId, stationLink: oldLink } = this;

    this.#preferredStation = station;
    const newLink = await this.createStationLink();
    const connector = this.#getVoiceConnector();

    if (newLink && connector) {
      if (!newLink.exciter.started) {
        await newLink.exciter.start(this.#adapter.getAudioDispatcher());
      }

      newLink.exciter.addCarrier(connector);
    }

    this.#updateAudiences('Tuned');

    const newStation = newLink?.station;

    if (newStation) {
      this.#automaton.emit('stationTuned', guildId, oldLink?.station, newStation);
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

    const config = this.#adapter.getConfig(this.guildId);
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

    this.#stationLink = newLink;

    return newLink;
  }

  async detune() {
    if (!this.stationLink) {
      return;
    }

    const { station, exciter } = this.stationLink;
    const connector = this.#getVoiceConnector();

    if (connector) {
      if (exciter.removeCarrier(connector) <= 0) {
        exciter.stop();
      }
    }

    station.removeAudiencesForGroup(this.#adapter.makeAudienceGroup(this.guildId));

    this.#stationLink = undefined;
  }

  async autoTune() {
    if (this.#stationLink) {
      return;
    }

    if (!this.preferredStation) {
      const config = this.#adapter.getConfig(this.guildId);
      const stations = this.#adapter.getStations();

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
      await this.createStationLink();
    }
  }

  async #doJoin(options: JoinOptions): Promise<JoinResult> {
    const { channel, timeout = 5000, retries = 0 } = options;

    const { me } = channel.guild.members;

    const granted = me && channel.permissionsFor(me).has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])

    if (!granted) {
      return { status: 'not_granted' }
    }

    await this.autoTune();

    const { stationLink } = this;

    if (!stationLink) {
      return { status: 'no_station' };
    }

    this.#getVoiceConnector()?.destroy();

    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    let connector = VoiceConnector.connect(
      {
        automatonId: this.#automaton.id,
        channelId,
        guildId,
        selfDeaf: true,
        selfMute: false,
      },
      voiceAdapterCreator
    );

    if (!connector || options?.signal?.aborted) {
      return { status: 'not_joined' };
    }

    const ac = new AbortController;
    const signal = options.signal ? AbortSignal.any([options.signal, ac.signal]) : ac.signal;
    const timer = setTimeout(() => ac.abort(``), timeout);
    ac.signal.addEventListener('abort', () => clearTimeout(timer));

    try {
      const result = await retryable<JoinResult>(async() => {
        await connector.waitForState(VoiceConnectorStatus.Ready, signal);

        if (signal.aborted) {
          throw new AbortRetryError();
        }

        return { status: 'joined', station: stationLink!.station };
      }, { retries, wait: 5000, factor: 1, signal });

      if (result === undefined) {
        return { status: 'aborted' };
      }

      if (!stationLink.exciter.started) {
        await stationLink.exciter.start(this.#adapter.getAudioDispatcher());
      }

      stationLink.exciter.addCarrier(connector);

      return result;
    }
    catch (e: any) {
      const wasAborted = e.code === 'ABORT_ERR';
      this.#adapter.getLogger().error(wasAborted ? new Error(e.cause) : e, 'Error joining channel: %s - guild: %s', channel.name, channel.guild.name);
      return { status: wasAborted ? 'aborted' : 'not_joined' };
    }
    finally {
      clearTimeout(timer);
    }
  }

  async join(options: JoinOptions): Promise<JoinResult> {
    this.#rejoinAC?.abort('join() called');
    return this.#doJoin(options);
  }

  async #checkVoiceConnector(timeoutSeconds: number) {
    if (!this.#designatedVC?.channelId) {
      return;
    }

    const isVoiceConnectorReady = () => this.#getVoiceConnector()?.state.status === VoiceConnectorStatus.Ready;

    if (isVoiceConnectorReady()) {
      return;
    }

    this.#rejoinAC?.abort();
    this.#rejoinAC = new AbortController();

    const client = this.#adapter.getClient();

    const joinTimeout = 5000;

    const retries = Math.ceil(timeoutSeconds * 1000 / (joinTimeout + 1000));

    await retryable<JoinResult>(async () => {
      // Prevent double join
      if (isVoiceConnectorReady() && this.stationLink) {
        return {
          status: 'joined',
          station: this.stationLink.station
        }
      }

      const channel = this.#designatedVC?.channelId ? client.channels.cache.get(this.#designatedVC.channelId) : undefined;

      if (!channel?.isVoiceBased()) {
        throw new AbortRetryError('not a voice based');
      }

      const result = await this.#doJoin({
        channel,
        timeout: joinTimeout,
        signal: this.#rejoinAC?.signal
      });

      if (result.status !== 'joined') {
        throw new Error('Retry');
      }

      this.#adapter.getLogger().info({ guild: channel.guild.name, channel: channel.name }, 'Rejoined');

      return result;
      }, { retries, wait: 1000, signal: this.#rejoinAC.signal }
    )
    .catch(noop) // `retryable` throw the error when reaching retries limit, so we silently ignore that and do it again in the next round
    .finally(() => {
      this.#rejoinAC = undefined;
    })
  }

  async startVCMonitor(interval: number) {
    // stop previous timer
    this.stopVCMonitor();

    this.#checkVCTimer = setTimeout(async () => {
      await this.#checkVoiceConnector(30);
      this.startVCMonitor(interval);
    }, interval);
  }

  async stopVCMonitor() {
    if (this.#checkVCTimer) {
      clearTimeout(this.#checkVCTimer);
      this.#checkVCTimer = undefined;
    }
  }

  async refreshVoiceState() {
    const guild = await this.#adapter.getClient().guilds.fetch(this.guildId);
    const vs = await guild.voiceStates.fetch('@me').catch(() => undefined);

    if (vs?.channel?.isVoiceBased()) {
      await this.#joinedVoiceChannel(vs.channel, isVoiceStateMuted(vs));
    }

    this.#updateAudiences('refreshVoiceState');
  }

  async #updateAudiences(reason?: string) {
    if (!this.#getVoiceConnector()) {
      return;
    }

    if (!this.#voiceChannelId || !this.preferredStation) {
      return;
    }

    const channel = this.#adapter.getChannel(this.#voiceChannelId);

    if ((channel?.type === ChannelType.GuildVoice) || (channel?.type === ChannelType.GuildStageVoice)) {
      const guild = await this.#adapter.getClient().guilds.fetch(this.guildId);
      const shouldPlay = guild.members.me?.voice !== undefined && !guild.members.me.voice.mute;

      this.preferredStation.updateAudiences(
        this.#adapter.makeAudienceGroup(this.guildId),
        channel.members
          .filter(member => !member.user.bot && !member.voice.deaf)
          .map(member => member.id),
        { updatePlayback: shouldPlay }
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

    const myId = this.#adapter.getClient().user?.id;
    const isMe = myId && (newState.member.id === myId);

    if (isMe) {
      this.#handleSelfState(oldState, newState);
    } else {
      this.#handleOthersState(oldState, newState);
    }
  }

  async #handleSelfState(oldState: VoiceState | null, newState: VoiceStateWithMember) {
    if (!this.tunedStation) {
      // Not tuned
      return;
    }

    if (!newState.channel) {
      // Not in a re-joining process
      if (this.#rejoinAC === undefined) {
        this.#leftVoiceChannel();
      }

      return;
    }

    if ((newState.channelId !== oldState?.channelId) || (newState.sessionId !== oldState.sessionId)) {
      // clear the active channel, this must be set when a voice connection is ready
      this.#designatedVC = undefined;
      await this.#joinedVoiceChannel(newState.channel, isVoiceStateMuted(newState));
    }

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

    const audienceGroup = this.#adapter.makeAudienceGroup(this.guildId);

    if (this.#serverMuted || !channel) {
      station.removeAudiencesForGroup(audienceGroup);
      return;
    }

    if (!this.#voiceChannelId) {
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

    const channel = this.#adapter.getChannel(this.#voiceChannelId);
    if (!channel?.isVoiceBased()) {
      return;
    }

    if (!this.#getVoiceConnector()) {
      return;
    }

    const audienceGroup = this.#adapter.makeAudienceGroup(this.guildId);

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

    const isOwnerOverride = this.#automaton.owners.includes(message.author.id);

    const shouldCheckAudiences = !isOwnerOverride && this.#adapter.getConfig(message.guildId)?.trackMessage?.always !== true;

    if (shouldCheckAudiences) {
      const audiences = station.getAudiences(this.#adapter.makeAudienceGroup(this.guildId));

      if (!audiences?.has(message.author.id)) {
        return;
      }
    }

    const createReply = async (url: URL, [type, id]: [string, string]): Promise<MessageReplyOptions | undefined> => {
      const searchKey = `spotify:${type}`;

      if (!['track', 'artist'].includes(type)) {
        return;
      }

      const fetchInfo = (url: string) => retryable(async () => fetchSpotifyInfo(url), { retries: 2, wait: 1 });

      const info = await fetchInfo(url.href);

      switch (type) {
        case 'track': {
          const trackInfo = info?.type === 'track' ? info : undefined;
          const artistUrl = first(trackInfo?.artist_urls);

          const dedicatedTracks = await station.findTracksByComment(searchKey, id, { valueDelimiter: ',' });

          const [track] = sortBy(dedicatedTracks, ...getStationTrackSorters(station));

          if (track) {
            const {
              title = trackInfo?.title || 'Unknown',
              artist = trackInfo?.artist || 'Unknown'
            } = track?.extra?.tags ?? {};

            const embed = new EmbedBuilder();

            if (trackInfo?.image) {
              embed.setThumbnail(trackInfo.image);
            }

            embed
              .setTitle('Found a dedicated track for this link')
              .addFields(
                { name: 'Title', value: quote(formatSpotifyField('title', title, id)) },
                { name: 'Artist', value: quote(artistUrl ? hyperlink(artist, artistUrl) : artist) },
              )

            if (!embed.data.thumbnail) {
              const cover = await createCoverImageAttachment(track, `cover-${this.#automaton.id}`);
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
                      .setCustomId(`request:track:${track.id}`)
                  )
              ]
            }
          }

          // Spotify track id did not match any tracks,
          // so try using metadata we've got from given spotify url to search for tracks and let user pick one

          if (!trackInfo?.artist || !trackInfo?.title) {
            const { baseCommand } = this.#automaton;

            return {
              content: `Could not retrieve track information, please try again later or try using command ${inlineCode(`/${baseCommand} request`)} instead`
            }
          }

          const artistId = ((url) => {
            const [type, id] = (url ? first(extractSpotifyUrl(url))?.paths : undefined) ?? [];
            return type === 'artist' ? id : undefined;
          })(artistUrl);

          const binding = {
            artist: trackInfo.artist,
            title: trackInfo.title,
            duration: trackInfo.duration,
            artist_id: artistId
          };

          // Search by Spotify trackInfo and show the potentials
          const searchResult = await station.search({
              q: {
                title: trackInfo.title,
                artist: trackInfo.artist
              },
              noHistory: true
            })
            .then(results => results.map(t => t.track));

          // This is possibly due to the track locale does not match, try to guess the locale and search again
          //
          // and this is just to find the potential and should not re-run on the request command
          // search will be perform audio wise, and find most likely tracks
          if (searchResult.length <= 0 && trackInfo.lang) {
            const lang = trackInfo.lang.toLowerCase();

            const trackLang = [trackInfo.title, trackInfo.artist]
              .map(s => detectLanguage(s)?.toLowerCase())
              .find(s => lang && s !== lang);

            if (trackLang) {
              const localizedUrl = new URL(url);
              localizedUrl.searchParams.set('locale', trackLang);

              const localizedInfo = await fetchInfo(localizedUrl.href);

              if (localizedInfo?.type === 'track') {
                if (localizedInfo.title && localizedInfo.artist) {
                  binding.title = localizedInfo.title;
                  binding.artist = localizedInfo.artist;

                  const localizedSearch = await station.search({
                    q: {
                      title: localizedInfo.title,
                      artist: localizedInfo.artist
                    },
                    noHistory: true
                  });

                  if (localizedSearch.length) {
                    binding.artist = localizedInfo.artist;
                    binding.title = localizedInfo.title;

                    searchResult.push(...localizedSearch.map(t => t.track));
                  }
                }
              }
            }
          }

          if (searchResult.length <= 0 && artistId) {
            const artistTracks = await station.findTracksByComment('spotify:artist', artistId, { valueDelimiter: ',' });
            searchResult.push(...artistTracks);
          }

          if (searchResult.length <= 0) {
            return;
          }

          const banners = uniq(searchResult.map(getTrackBanner));

          const sampleBanners = take(banners, 3).map(s => `- ${s}`);

          if (sampleBanners.length < banners.length) {
            sampleBanners.push('...');
          }

          const embed = new EmbedBuilder();

          embed.setTitle(`Found some potential tracks for this title`);

          if (sampleBanners.length) {
            embed.setDescription(sampleBanners.join('\n'))
          }

          // transfer binding value via embed fields
          embed.addFields(
            { name: 'artist', value: artistUrl ? hyperlink(binding.artist, artistUrl) : binding.artist, inline: true },
            { name: 'title', value: binding.title, inline: true },
          );

          if (binding.duration && binding.duration > 0) {
            embed.addFields(
              { name: 'duration', value: `${formatDuration(binding.duration)}`, inline: true }
            );
          }

          if (binding.artist_id) {
            embed.addFields(
              { name: 'artist_id', value: binding.artist_id }
            );
          }

          return {
            embeds: [embed],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                  new ButtonBuilder()
                    .setLabel('Search')
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId(`request:track_search:${id}`)
                )
            ]
          }
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
            .then(s => s.filter(r => !exactIds.has(r.track.id)))

          if (exactMatches.length + searchResult.length) {
            const exactMatchBanners = uniq(exactMatches.map(getTrackBanner));
            const searchResultBanners = uniq(searchResult.map(r => getTrackBanner(r.track)));

            const counter = [
                exactMatchBanners.length ? `${exactMatchBanners.length} track(s)` : undefined,
                searchResultBanners.length ? `${searchResultBanners.length} potential track(s)` : undefined
              ]
              .filter((s): s is string => s !== undefined)
              .join(' and ');

            const sampleBanners = take(exactMatchBanners, 3).map(s => `- ${s}`);

            if (sampleBanners.length < 3 && searchResultBanners.length) {
              sampleBanners.push(...take(searchResultBanners, 3 - sampleBanners.length).map(s => `- ${s}`));
            }

            if (sampleBanners.length < (exactMatches.length + searchResultBanners.length)) {
              sampleBanners.push('...');
            }

            embed
              .setTitle(`Found ${counter} for this artist`)
              .setDescription(sampleBanners.join('\n'))
              .addFields(
                { name: 'artist', value: info.artist }
              );

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

export type JoinOptions = {
  channel: BaseGuildVoiceChannel;
  timeout?: number;
  retries?: number;
  signal?: AbortSignal;
}

export type JoinResult = {
  status: 'no_station' | 'not_granted' | 'not_joined' | 'aborted';
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

function isVoiceStateMuted(s: VoiceState | null) {
  return (s?.suppress || s?.serverMute) === true;
}

function detectLanguage(s: string) {
  return sortBy(detectLanguages(s), d => -d.accuracy).find(d => d.accuracy >= 0.88)?.lang;
}
