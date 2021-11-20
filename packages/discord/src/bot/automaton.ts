/// <reference path="../types.d.ts" />

import { REST as RestClient } from "@discordjs/rest";
import {
  BoomBoxTrack,
  BoomBoxTrackPlay, getTrackBanner, TrackKind
} from "@medley/core";
import { Routes } from "discord-api-types/v9";
import {
  BaseGuildVoiceChannel, Client, Guild,
  Intents, MessageOptions,
  MessagePayload, Snowflake, VoiceState
} from "discord.js";

import _, { without } from "lodash";
import { createCommandDeclarations, createInteractionHandler } from "./command";
import { MedleyMix } from "./mix";
import { createTrackMessage, TrackMessage, TrackMessageStatus, trackMessageToMessageOptions } from "./trackmessage";

export type MedleyAutomatonOptions = {
  clientId: string;
  botToken: string;
  // TODO: Use this
  owners?: Snowflake[];
}

type AutomatonGuildState = {
  voiceChannelId?: BaseGuildVoiceChannel['id'];
  trackMessages: TrackMessage[];
  audiences: Snowflake[];
  serverMuted: boolean;
}

export class MedleyAutomaton {
  readonly client: Client;

  private _guildStates: Map<Guild['id'], AutomatonGuildState> = new Map();

  constructor(readonly dj: MedleyMix, private options: MedleyAutomatonOptions) {
    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_VOICE_STATES
      ]
    });

    this.client.on('error', (error) => {
      console.log('Error', error);
    });

    this.client.on('ready', this.handleClientReady);
    this.client.on('guildCreate', this.handleGuildCreate);
    this.client.on('guildDelete', this.handleGuildDelete);
    this.client.on('voiceStateUpdate', this.handleVoiceStateUpdate);
    this.client.on('interactionCreate', createInteractionHandler('medley', this));

    this.dj.on('trackStarted', this.handleTrackStarted);
    this.dj.on('trackActive', this.handleTrackActive);
    this.dj.on('trackFinished', this.handleTrackFinished);
  }

  login() {
    this.client.login(this.options.botToken);
  }

  private ensureGuildState(id: Guild['id']) {
    if (this._guildStates.has(id)) {
      return;
    }

    this._guildStates.set(id, {
      voiceChannelId: undefined,
      trackMessages: [],
      audiences: [],
      serverMuted: false
    });
  }

  getGuildState(id: Guild['id']): AutomatonGuildState | undefined {
    return this._guildStates.get(id);
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

  private detectVoiceChannelChange(oldState: VoiceState, newState: VoiceState): 'join' | 'leave' | 'move' | 'invalid' | undefined {
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

  private handleVoiceStateUpdate = async (oldState: VoiceState, newState: VoiceState) => {
    this.ensureGuildState(newState.guild.id);
    const state = this._guildStates.get(newState.guild.id)!;

    const channelChange = this.detectVoiceChannelChange(oldState, newState);
    if (channelChange === 'invalid' || !newState.member) {
      return;
    }

    const isMe = (newState.member.id === newState.guild.me?.id);

    if (isMe) {
      if (channelChange === 'leave') {
        console.log('Me Leaving');
        state.audiences = [];
        state.voiceChannelId = undefined;
        this.audiencesOrServerMuteUpdated();
        return;
      }

      if (newState.channelId !== state.voiceChannelId) {
        console.log('Me Just joined or moved, collecting...');

        state.voiceChannelId = newState.channelId || undefined;

        const { members } = newState.channel!;

        state.audiences = members
          .filter((member, id) => !member.user.bot && !newState.guild.voiceStates.cache.get(id)?.deaf)
          .map((member, id) => id);

        this.audiencesOrServerMuteUpdated();

        if (state.audiences.length < 1) {
          console.log('No one is listening');
        }
      }

      if (oldState.serverMute != newState.serverMute) {
        state.serverMuted = !!newState.serverMute;
        this.audiencesOrServerMuteUpdated();
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
      state.audiences = without(state.audiences, newState.member.id);
      this.audiencesOrServerMuteUpdated();
      return;
    }

    if (channelChange === 'join' || channelChange === 'move') {
      if (newState.channelId === state.voiceChannelId) {
        console.log(newState.member.displayName, 'is joining or moving to my channel', 'deaf?', newState.deaf);
        if (!newState.deaf) {
          state.audiences.push(newState.member.id);
          this.audiencesOrServerMuteUpdated();
        }

        return;
      }

      if (oldState.channelId === state.voiceChannelId) {
        console.log(newState.member.displayName, 'is moving away from my channel');
        state.audiences = without(state.audiences, newState.member.id);
        this.audiencesOrServerMuteUpdated();

        return;
      }

      console.log(newState.member.displayName, 'is joining or moving to other channel');
      return;
    }

    // No channel change
    if (oldState.deaf !== newState.deaf && newState.channelId === state.voiceChannelId) {
      if (!newState.deaf) {
        state.audiences.push(newState.member.id);
      } else {
        state.audiences = without(state.audiences, newState.member.id);
      }

      this.audiencesOrServerMuteUpdated();
    }
  }

  private audiencesOrServerMuteUpdated() {
    console.log('Audiences updated');

    for (const [guildId, state] of this._guildStates) {
      if (!state.voiceChannelId) {
        state.audiences = [];
      }

      if (!state.serverMuted && state.audiences.length > 0) {
        // has some audience
        this.dj.start();
        this.showActivity();
        return;
      }
    }

    // no audience, pause
    this.hideActivity();
    this.dj.pause();
  }

  private showActivity() {
    const { user } = this.client;

    if (!user) {
      return;
    }

    const { trackPlay } = this.dj;
    const banner = trackPlay ? getTrackBanner(trackPlay.track) : 'Medley';

    user.setActivity(banner, { type: 'LISTENING' });
  }

  private hideActivity() {
    this.client.user?.setPresence({ activities: [] });
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

  private handleTrackStarted = async (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    this.showActivity();

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

  private handleTrackActive = async (trackPlay: BoomBoxTrackPlay) => _.delay(() => this.updateTrackMessage(
    trackPlay,
    async () => true,
    {
      showSkip: true,
      showLyrics: true
    }
  ), 1000);

  private handleTrackFinished = async (trackPlay: BoomBoxTrackPlay) => this.updateTrackMessage(
    trackPlay,
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

  skipCurrentSong() {
    if (!this.dj.paused && this.dj.playing) {
      const { trackPlay } = this.dj;

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

      this.dj.skip();
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
          const { voiceChannelId, audiences } = state;

          if (voiceChannelId && audiences.length) {
            // TODO: Configurable channel
            return guild.systemChannel?.send(options).catch(() => undefined)
          }
        }
      })
    );

    return results;
  }

  static async registerCommands(botToken: string, clientId: string, guildId: string) {
    const client = new RestClient({ version: '9' })
      .setToken(botToken);

    await client.put(
      Routes.applicationGuildCommands(clientId, guildId),
      {
        body: [createCommandDeclarations('medley')]
      }
    );

    console.log('Registered');
  }

  async registerCommands(guildId: string) {
    return MedleyAutomaton.registerCommands(this.options.botToken, this.options.clientId, guildId);
  }
}