/// <reference path="../types.d.ts" />

import { REST as RestClient } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";

import {
  AudioPlayer,
  AudioResource,
  createAudioPlayer,
  DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnection,
  VoiceConnectionStatus
} from "@discordjs/voice";

import {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel, Client, Guild,
  Intents, Message, MessageOptions,
  MessagePayload, Snowflake, VoiceBasedChannel, VoiceState
} from "discord.js";

import {
  BoomBoxTrack,
  BoomBoxTrackPlay, IReadonlyLibrary, RequestAudioStreamResult, TrackKind,
  createLogger, Logger, decibelsToGain
} from "@seamless-medley/core";

import type TypedEventEmitter from 'typed-emitter';

import { delay } from "lodash";
import { createCommandDeclarations, createInteractionHandler } from "./command";
import { Station } from "./station";
import { createTrackMessage, TrackMessage, TrackMessageStatus, trackMessageToMessageOptions } from "./trackmessage";

import EventEmitter from "events";
import { createExciter } from "./station/exciter";

export type MedleyAutomatonOptions = {
  id: string;
  /**
   * Default to 'medley'
   *
   * @default 'medley'
   */
  baseCommand?: string;
  clientId: string;
  botToken: string;
  owners?: Snowflake[];

  /**
   * Initial audio gain, default to -15dBFS (Appx 0.178)
   * @default -15dBFS
   */
   initialGain?: number;

  /**
   * @default 3
   */
  maxTrackMessages?: number;
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

export type JoinResult = {
  status: 'no_station' | 'not_joined';
} | {
  status: 'joined';
  station: Station;
}

export interface AutomatonEvents {
  ready: () => void;
}

export class MedleyAutomaton extends (EventEmitter as new () => TypedEventEmitter<AutomatonEvents>) {
  readonly id: string;

  botToken: string;
  clientId: string;

  owners: Snowflake[] = [];

  maxTrackMessages: number = 3;

  initialGain: number;

  readonly baseCommand: string;

  readonly client: Client;

  private _guildStates: Map<Guild['id'], GuildState> = new Map();

  private logger: Logger;

  constructor(
    readonly stations: IReadonlyLibrary<Station>,
    options: MedleyAutomatonOptions
  ) {
    super();

    this.logger = createLogger({ name: `automaton/${options.id}` });

    this.id = options.id;
    this.botToken = options.botToken;
    this.clientId = options.clientId;
    this.owners = options.owners || [];
    this.maxTrackMessages = options.maxTrackMessages ?? 3;
    this.initialGain = options.initialGain ?? decibelsToGain(-15);
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
      this.logger.error('Automaton Error', error);
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

  get isReady() {
    return this.client.isReady();
  }

  async login() {
    this.logger.info('Logging in');

    await this.client.login(this.botToken)
      .catch(e => {
        this.logger.error('Error login', e);
        throw e;
      });
  }

  ensureGuildState(guildId: Guild['id']) {
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

    const exciter = createExciter(await selectedStation.requestAudioStream({
      bufferSize: 48000 * 5.0,
      buffering: 960, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
      preFill: 48000 * 0.5, // Pre-fill the stream with at least 500ms of audio, to reduce stuttering while encoding to Opus
      // discord voice only accept 48KHz sample rate, 16 bit per sample
      sampleRate: 48000,
      format: 'Int16LE',
      gain: this.initialGain
    }));

    // Create discord voice AudioPlayer if neccessary
    const audioPlayer = stationLink?.audioPlayer ?? createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 1000
      }
    });

    audioPlayer.play(exciter);

    const newLink: StationLink = {
      station: selectedStation,
      audioPlayer,
      audioResource: exciter,
      audioRequest: exciter.metadata,
      voiceConnection: stationLink?.voiceConnection
    };

    if (newLink.voiceConnection) {
      const { channelId } = newLink.voiceConnection.joinConfig;
      if (channelId) {
        const channel = this.client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
        if (channel?.isVoice()) {
          this.updateStationAudiences(selectedStation, channel);
        }
      }
    }

    if (currentStation) {
      this.detune(guildId);
    }

    state.stationLink = newLink;
    state.gain = this.initialGain;

    return newLink;
  }

  async tune(guildId: Guild['id'], station?: Station): Promise<Station | false> {
    if (station) {
      this.setGuildStation(guildId, station);
    }

    const link = await this.internal_tune(guildId);
    return link?.station ?? false;
  }

  private async detune(guildId: Guild['id']) {
    const link = this._guildStates.get(guildId)?.stationLink;

    if (!link) {
      return;
    }

    const { station, audioRequest } = link;

    station.medley.deleteAudioStream(audioRequest.id);
    station.removeAudiencesForGroup(guildId);
  }

  getGain(guildId: Guild['id']) {
    const state = this._guildStates.get(guildId);
    return state?.gain ?? this.initialGain ?? 1.0;
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
      return { status: 'no_station' };
    }

    const voiceConnection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator as DiscordGatewayAdapterCreator
    }) as VoiceConnection | undefined;

    if (!voiceConnection) {
      return { status: 'not_joined' };
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
    return { status: 'joined', station: stationLink.station };
  }

  private handleClientReady = async (client: Client) => {
    const guilds = await client.guilds.fetch();

    await Promise.all(guilds.map((guild) => {
      this.ensureGuildState(guild.id);
      return this.registerCommands(guild.id);
    }));

    this.logger.info('Ready');
    this.emit('ready');

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
    const guildId = newState.guild.id;
    const state = this.ensureGuildState(guildId);

    const station = this.getTunedStation(guildId);

    const channelChange = detectVoiceChannelChange(oldState, newState);
    if (channelChange === 'invalid' || !newState.member) {
      return;
    }

    const isMe = (newState.member.id === newState.guild.me?.id);

    if (isMe) {
      if (channelChange === 'leave') {
        // Me Leaving
        station?.removeAudiencesForGroup(newState.guild.id);
        state.voiceChannelId = undefined;
        return;
      }

      if (newState.channelId !== state.voiceChannelId) {
        // Me Just joined or moved, collecting...

        state.voiceChannelId = newState.channelId || undefined;
        state.serverMuted = !!newState.serverMute;

        if (station) {
          if (state.serverMuted) {
            station.removeAudiencesForGroup(guildId);
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
            station.removeAudiencesForGroup(guildId);
          } else {
            this.updateStationAudiences(station, newState.channel!);
          }
        }
      }

      return;
    }

    if (newState.member.user.bot) {
      // Ignoring bot user
      return;
    }

    if (!state.voiceChannelId) {
      // Me not in a room, ignoring...
      return;
    }

    // state change is originated from other member that is in the same room as me.

    if (channelChange === 'leave') {
      if (oldState.channelId !== state.voiceChannelId) {
        // is not leaving my channel
        return;
      }

      // is leaving
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

      // is joining or moving to other channel
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
    // Invited into

    this.ensureGuildState(guild.id)
    this.registerCommands(guild.id);
  }

  private handleGuildDelete = async (guild: Guild) => {
    // Removed from
    this._guildStates.delete(guild.id);
  }

  private handleTrackStarted = (station: Station) => async (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    const trackMsg = await createTrackMessage(trackPlay, station.findTrackById(trackPlay.track.id));
    const sentMessages = await this.sendForStation(station, trackMessageToMessageOptions({
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

        while (state.trackMessages.length > this.maxTrackMessages) {
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
   * Send to all guilds for a station
   */
  private async sendForStation(station: Station, options: string | MessagePayload | MessageOptions) {
    const results: [string, Promise<Message<boolean> | undefined> | undefined][] = [];

    for (const guildId of station.groupIds) {
      if ((station.getAudiences(guildId)?.size ?? 0) < 1) {
        continue;
      }

      const state = this._guildStates.get(guildId);

      if (state) {
        const guild = this.client.guilds.cache.get(guildId);
        const { voiceChannelId, textChannelId } = state;

        if (guild && voiceChannelId) {
          const channel = textChannelId ? guild.channels.cache.get(textChannelId) : undefined;
          const textChannel = channel?.isText() ? channel : undefined;

          const d = (textChannel || guild.systemChannel)?.send(options).catch(() => undefined);

          results.push([guildId, d]);
        }
      }
    }

    return results;
  }

  async registerCommands(guildId: string) {
    const client = new RestClient({ version: '9' }).setToken(this.botToken);

    try {
      await client.put(
        Routes.applicationGuildCommands(this.clientId, guildId),
        {
          body: [createCommandDeclarations(this.baseCommand || 'medley')]
        }
      );

      this.logger.info('Registered commands with guild id:', guildId);
    }
    catch (e) {
      this.logger.error('Error registering command', e);
    }
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