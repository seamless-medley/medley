/// <reference path="../types.d.ts" />

import { REST as RestClient } from "@discordjs/rest";
import { AudioPlayer, AudioResource, createAudioPlayer, DiscordGatewayAdapterCreator, entersState, joinVoiceChannel, NoSubscriberBehavior, VoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import {
  BoomBoxTrack,
  BoomBoxTrackPlay, RequestAudioStreamResult, TrackKind
} from "@seamless-medley/core";
import { Routes } from "discord-api-types/v9";
import {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel, Client, Guild,
  Intents, MessageOptions,
  MessagePayload, Snowflake, User, VoiceState
} from "discord.js";

import { delay } from "lodash";
import { createCommandDeclarations, createInteractionHandler } from "./command";
import { PlayState, Station } from "./station";
import { createTrackMessage, TrackMessage, TrackMessageStatus, trackMessageToMessageOptions } from "./trackmessage";
import { IReadonlyCollection } from "./utils/collection";

export type MedleyAutomatonOptions = {
  /**
   * Default to 'medley'
   *
   * @default 'medley'
   */
  baseCommand?: string;
  clientId: string;
  botToken: string;
  // TODO: Use this
  owners?: Snowflake[];
}

type StationLink = {
  station: Station;
  audioRequest: RequestAudioStreamResult;
  audioResource: AudioResource;
  audioPlayer: AudioPlayer;
  voiceConnection?: VoiceConnection;
}

type GuildState = {
  guildId: Guild['id'],
  voiceChannelId?: BaseGuildVoiceChannel['id'];
  textChannelId?: BaseGuildTextChannel['id'];
  trackMessages: TrackMessage[];
  serverMuted: boolean;
  selectedStation?: Station;
  stationLink?: StationLink;
  gain: number;
}

export type JoinResult = 'no_station' | 'not_joined' | 'joined';

export class MedleyAutomaton {
  botToken: string;
  clientId: string;

  readonly baseCommand: string;

  readonly client: Client;

  private _guildStates: Map<Guild['id'], GuildState> = new Map();

  constructor(
    private stations: IReadonlyCollection<Station>,
    options: MedleyAutomatonOptions
  ) {
    this.botToken = options.botToken;
    this.clientId = options.clientId;
    this.baseCommand = options.baseCommand || 'medley';

    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.GUILD_VOICE_STATES,
      ]
    });

    this.client.on('error', (error) => {
      console.log('Error', error);
    });

    this.client.on('ready', this.handleClientReady);
    this.client.on('guildCreate', this.handleGuildCreate);
    this.client.on('guildDelete', this.handleGuildDelete);
    this.client.on('voiceStateUpdate', this.handleVoiceStateUpdate);
    this.client.on('interactionCreate', createInteractionHandler(this.baseCommand, this));

    for (const station of stations) {
      station.on('trackStarted', this.handleTrackStarted(station));
      station.on('trackActive', this.handleTrackActive);
      station.on('trackFinished', this.handleTrackFinished);
    }
  }

  login() {
    this.client.login(this.botToken);
  }

  private ensureGuildState(guildId: Guild['id']) {
    if (!this._guildStates.has(guildId)) {
      this._guildStates.set(guildId, {
        guildId,
        voiceChannelId: undefined,
        trackMessages: [],
        serverMuted: false,
        gain: 1.0
      });
    }

    return this._guildStates.get(guildId)!;
  }

  getGuildState(id: Guild['id']): GuildState | undefined {
    return this._guildStates.get(id);
  }

  getTunedStation(id: Guild['id']): Station | undefined {
    const state = this.getGuildState(id);
    return state?.stationLink?.station;
  }

  getGuildStation(id: Guild['id']): Station | undefined {
    const state = this.getGuildState(id);
    return state?.selectedStation;
  }

  setGuildStation(id: Guild['id'], station: Station): boolean {
    const state = this.getGuildState(id);
    if (!state) {
      return false;
    }

    state.selectedStation = station;
    return true;
  }

  private async internal_tune(guildId: Guild['id']): Promise<StationLink | undefined> {
    const state = this.ensureGuildState(guildId);

    const { selectedStation, stationLink } = state;

    if (!selectedStation) {
      return stationLink;
    }

    const currentStation = stationLink?.station;

    if (currentStation === selectedStation) {
      return stationLink;
    }

    if (currentStation) {
      this.detune(guildId);
    }

    const exciter = await selectedStation.createExciter();

    // Create discord voice AudioPlayer
    const audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 1000
      }
    });

    audioPlayer.play(exciter);

    const newLink = {
      station: selectedStation,
      audioPlayer,
      audioResource: exciter,
      audioRequest: exciter.metadata,
    };

    state.stationLink = newLink;
    state.gain = selectedStation.initialGain;

    return newLink;
  }

  async tune(guildId: Guild['id'], station?: Station): Promise<boolean> {
    if (station) {
      this.setGuildStation(guildId, station);
    }

    const link = await this.internal_tune(guildId);
    return link !== undefined;
  }

  private async detune(guildId: Guild['id']) {
    const link = this._guildStates.get(guildId)?.stationLink;

    if (!link) {
      return;
    }

    const { station, audioRequest } = link;

    station.medley.deleteAudioStream(audioRequest.id);
    station.removeAudiencesForGuild(guildId);
  }

  getGain(guildId: Guild['id']) {
    const state = this._guildStates.get(guildId);
    return state?.gain ?? state?.stationLink?.station.initialGain ?? 1.0;
  }

  setGain(guildId: Guild['id'], gain: number): boolean {
    const state = this._guildStates.get(guildId);
    if (!state) {
      return false;
    }

    state.gain = gain;

    const { stationLink } = state;

    if (stationLink) {
      const { station, audioRequest } = stationLink;
      station.medley.updateAudioStream(audioRequest.id, { gain });
    }

    return true;
  }

  async join(channel: BaseGuildVoiceChannel): Promise<JoinResult> {
    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    const state = this.ensureGuildState(guildId);

    let { stationLink, selectedStation } = state;

    // Auto-tuning
    if (!stationLink && this.stations.size === 1) {
      if (!selectedStation) {
        selectedStation = this.stations.first();

        if (selectedStation) {
          this.setGuildStation(guildId, selectedStation);
        }
      }

      stationLink = await this.internal_tune(guildId);
    }

    if (!stationLink) {
      return 'no_station';
    }

    const voiceConnection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator as DiscordGatewayAdapterCreator
    }) as VoiceConnection | undefined;

    if (!voiceConnection) {
      return 'not_joined';
    }

    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 30e3);
      voiceConnection.subscribe(stationLink.audioPlayer);
    }
    catch (e) {
      voiceConnection?.destroy();

      throw e;
    }

    stationLink.voiceConnection = voiceConnection;
    return 'joined';
  }

  private handleClientReady = async (client: Client) => {
    console.log('Ready');

    const guilds = await client.guilds.fetch();
    for (const [id] of guilds) {
      this.ensureGuildState(id);
      this.registerCommands(id);
    }

    // TODO: Try to join last voice channel
  }

  private updateStationAudiences(station: Station, channel: VoiceBasedChannel) {
    station.updateAudiences(
      channel.guildId,
      channel.members
        .filter(member => !member.user.bot && !channel.guild.voiceStates.cache.get(member.id)?.deaf)
        .map(member => member.id)
    );
  }
  private handleVoiceStateUpdate = async (oldState: VoiceState, newState: VoiceState) => {
    const state = this.ensureGuildState(newState.guild.id);

    const channelChange = detectVoiceChannelChange(oldState, newState);
    if (channelChange === 'invalid' || !newState.member) {
      return;
    }

    const isMe = (newState.member.id === newState.guild.me?.id);

    if (isMe) {
      if (channelChange === 'leave') {
        console.log('Me Leaving');
        station?.removeAudiencesForGuild(newState.guild.id);
        state.voiceChannelId = undefined;
        return;
      }

      if (newState.channelId !== state.voiceChannelId) {
        console.log('Me Just joined or moved, collecting...');

        state.voiceChannelId = newState.channelId || undefined;
        state.serverMuted = !!newState.serverMute;

        if (station) {
          if (state.serverMuted) {
            station.removeAudiencesForGuild(guildId);
          } else {
            this.updateStationAudiences(station, newState.channel!);
          }
        }

        return;
      }

      if (oldState.serverMute != newState.serverMute) {
        state.serverMuted = !!newState.serverMute;

        if (station) {
          if (state.serverMuted) {
            station.removeAudiencesForGuild(guildId);
          } else {
            this.updateStationAudiences(station, newState.channel!);
          }
        }
      }

      return;
    }

    if (newState.member.user.bot) {
      console.log('Ignoring bot user');
      return;
    }

    if (!state.voiceChannelId) {
      console.log('Me not in a room, ignoring...');
      return;
    }

    // state change is originated from other member that is in the same room as me.

    if (channelChange === 'leave') {
      if (oldState.channelId !== state.voiceChannelId) {
        console.log(newState.member.displayName, 'is not leaving my channel');
        return;
      }

      console.log(newState.member.displayName, 'is leaving');
      station?.removeAudiences(guildId, newState.member.id);
      return;
    }

    if (channelChange === 'join' || channelChange === 'move') {
      if (newState.channelId === state.voiceChannelId) {
        if (!newState.deaf) {
          // User has joined or moved into
          station?.addAudiences(guildId, newState.member.id);
        }

        return;
      }

      if (oldState.channelId === state.voiceChannelId) {
        // User has moved away
        station?.removeAudiences(guildId, newState.member.id);
        return;
      }

      console.log(newState.member.displayName, 'is joining or moving to other channel');
      return;
    }

    // No channel change
    if (oldState.deaf !== newState.deaf && newState.channelId === state.voiceChannelId) {
      if (!newState.deaf) {
        station?.addAudiences(guildId, newState.member.id);
      } else {
        station?.removeAudiences(guildId, newState.member.id);
      }
    }
  }

  private handleGuildCreate = async (guild: Guild) => {
    console.log('Invited into ', guild.name);

    this.ensureGuildState(guild.id)
    this.registerCommands(guild.id);
  }

  private handleGuildDelete = async (guild: Guild) => {
    console.log('Removed from guild', guild.name);
    this._guildStates.delete(guild.id);
  }

  private handleTrackStarted = (station: Station) => async (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    // this.showActivity();

    const trackMsg = await createTrackMessage(trackPlay);
    const sentMessages = await this.sendAll(trackMessageToMessageOptions({
      ...trackMsg,
      buttons: {
        lyric: trackMsg.buttons.lyric,
        skip: undefined
      }
    }));

    // Store message for each guild
    for (const [guildId, maybeMessage] of sentMessages) {
      const state = this._guildStates.get(guildId);
      if (state) {
        state.trackMessages.push({
          ...trackMsg,
          sentMessage: await maybeMessage
        });

        // TODO: Configurable number
        while (state.trackMessages.length > 3) {
          const oldMsg = state.trackMessages.shift();
          if (oldMsg) {
            const { sentMessage, lyricMessage } = oldMsg;

            if (sentMessage?.deletable) {
              sentMessage.delete();
            }

            if (lyricMessage?.deletable) {
              lyricMessage.delete();
            }
          }
        }
      }
    }
  }

  private handleTrackActive = async (trackPlay: BoomBoxTrackPlay) => delay(() => this.updateTrackMessage(trackPlay,
    async () => true,
    {
      showSkip: true,
      showLyrics: true
    }
  ), 1000);

  private handleTrackFinished = async (trackPlay: BoomBoxTrackPlay) => this.updateTrackMessage(trackPlay,
    async msg => msg.status < TrackMessageStatus.Played,
    {
      status: TrackMessageStatus.Played,
      title: 'Played',
      showSkip: false,
      showLyrics: true
    }
  );

  private async updateTrackMessage(
    trackPlay: BoomBoxTrackPlay,
    predicate: (msg: TrackMessage) => Promise<boolean>,
    options: {
      status?: TrackMessageStatus;
      title?: string;
      showSkip?: boolean;
      showLyrics?: boolean;
    }
  ) {
    for (const state of this._guildStates.values()) {
      const msg = state.trackMessages.find(msg => msg.trackPlay.uuid === trackPlay.uuid);

      if (msg) {
        if (await predicate(msg)) {
          const { status: newStatus, title: newTitle, showSkip, showLyrics } = options;

          if (newStatus) {
            msg.status = newStatus;
          }

          if (newTitle) {
            msg.embed.setTitle(newTitle);
          }

          const changed = !!newStatus || !!newTitle || showSkip || showLyrics;

          if (changed) {
            const { sentMessage } = msg;

            if (sentMessage?.editable) {
              sentMessage.edit(trackMessageToMessageOptions({
                ...msg,
                buttons: {
                  lyric: showLyrics ? msg.buttons.lyric : undefined,
                  skip: showSkip ? msg.buttons.skip : undefined
                }
              }));
            }
          }
        }
      }
    }
  }

  async removeLyricsButton(trackId: BoomBoxTrack['id']) {
    for (const state of this._guildStates.values()) {

      const messages = state.trackMessages.filter(msg => msg.trackPlay.track.id === trackId);
      for (const msg of messages) {
        msg.buttons.lyric = undefined;

        const showSkipButton = msg.status < TrackMessageStatus.Played;

        const { sentMessage } = msg;
        if (sentMessage?.editable) {
          sentMessage.edit(trackMessageToMessageOptions({
            ...msg,
            buttons: {
              lyric: undefined,
              skip: showSkipButton ? msg.buttons.skip : undefined
            }
          }));
        }
      }
    }
  }

  skipCurrentSong(id: Guild['id']) {
    const station = this.getTunedStation(id);

    if (!station) {
      return;
    }

    if (!station.paused && station.playing) {
      const { trackPlay } = station;

      if (trackPlay) {
        this.updateTrackMessage(
          trackPlay,
          async () => true,
          {
            title: 'Skipped',
            status: TrackMessageStatus.Skipped,
            showSkip: false,
            showLyrics: true
          }
        );
      }

      station.skip();
    }
  }

  /**
   * Send to all guilds
   */
  private async sendAll(options: string | MessagePayload | MessageOptions) {
    const results = await Promise.all(
      this.client.guilds.cache.mapValues(async (guild, id) => {
        const state = this._guildStates.get(id);

        if (state) {
          const { voiceChannelId, textChannelId, audiences } = state;

          if (voiceChannelId && audiences.size) {
            const channel = textChannelId ? guild.channels.cache.get(textChannelId) : undefined;
            const textChannel = channel?.isText() ? channel : undefined;
            return (textChannel || guild.systemChannel)?.send(options).catch(() => undefined);
          }
        }
      })
    );

    return results;
  }

  static async registerCommands(baseCommand: string, botToken: string, clientId: string, guildId: string) {
    const client = new RestClient({ version: '9' })
      .setToken(botToken);

    await client.put(
      Routes.applicationGuildCommands(clientId, guildId),
      {
        body: [createCommandDeclarations(baseCommand)]
      }
    );

    console.log('Registered');
  }

  async registerCommands(guildId: string) {
    return MedleyAutomaton.registerCommands(this.baseCommand || 'medley', this.botToken, this.clientId, guildId);
  }
}

function detectVoiceChannelChange(oldState: VoiceState, newState: VoiceState): 'join' | 'leave' | 'move' | 'invalid' | undefined {
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