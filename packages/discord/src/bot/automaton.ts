/// <reference path="../types.d.ts" />

import { REST as RestClient } from "@discordjs/rest";
import { BoomBoxTrack, TrackKind } from "@medley/core";
import { decibelsToGain, gainToDecibels } from "@medley/core/src/utils";
import { Routes } from "discord-api-types/v9";
import { BaseCommandInteraction, BaseGuildVoiceChannel, ButtonInteraction, Client, CommandInteraction, Guild, Intents, Interaction, InteractionReplyOptions, Message, MessageActionRow, MessageAttachment, MessageButton, MessageEmbed, MessageOptions, MessagePayload, Permissions, Snowflake, VoiceState } from "discord.js";
import _, { capitalize, castArray, first, isEmpty, without } from "lodash";
import { parse as parsePath } from "path";
import mime from 'mime-types';
import splashy from 'splashy';
import colorableDominant from 'colorable-dominant';
import commands from "./commands";
import { MedleyMix } from "./mix";

export type MedleyAutomatonOptions = {
  clientId: string;
  botToken: string;
  owners?: Snowflake[];
}

export enum HighlightTextType {
  Cyan = 'yaml',
  Yellow = 'fix',
  Red = 'diff'
}

// TODO: Use this for each guild
type AutomatonGuildState = {
  voiceChannelId?: BaseGuildVoiceChannel['id'];
  trackMessages: TrackMessage[];
  audiences: Snowflake[];
}

type TrackMessage = {
  embed: MessageEmbed;
  coverImage?: MessageAttachment;
  buttons: {
    skip: MessageButton,
    lyric: MessageButton
  };
  sentMessage?: Message;
}

export class MedleyAutomaton {
  readonly client: Client;

  private states: Map<Guild['id'], AutomatonGuildState> = new Map();

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
    this.client.on('interactionCreate', this.handleInteraction);

    this.dj.on('trackStarted', this.handleTrackStarted);
  }

  login() {
    this.client.login(this.options.botToken);
  }

  private ensureGuildState(id: Guild['id']) {
    if (this.states.has(id)) {
      return;
    }

    this.states.set(id, {
      voiceChannelId: undefined,
      trackMessages: [],
      audiences: []
    });
  }

  private handleClientReady = async (client: Client) => {
    console.log('Ready');

    const guilds = await client.guilds.fetch();
    for (const [id] of guilds) {
      this.ensureGuildState(id);
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
    const state = this.states.get(newState.guild.id)!;

    const channelChange = this.detectVoiceChannelChange(oldState, newState);
    if (channelChange === 'invalid' || !newState.member) {
      return;
    }

    // Who made this change?
    const isMe = (newState.member.id === newState.guild.me?.id);

    if (isMe) {
      if (channelChange === 'leave') {
        console.log('Me Leaving');
        state.audiences = [];
        state.voiceChannelId = undefined;
        this.audiencesUpdated();
        return;
      }

      if (newState.channelId !== state.voiceChannelId) {
        console.log('Me Just joined or moved, collecting...');
        const { members } = newState.channel!;

        state.audiences = members
          .filter((member, id) => !member.user.bot && !newState.guild.voiceStates.cache.get(id)?.deaf)
          .map((member, id) => id);

        this.audiencesUpdated();

        if (state.audiences.length < 1) {
          console.log('No one is listening');
        }
      }

      state.voiceChannelId = newState.channelId || undefined;
      console.log('Set state.voiceChannelId', state.voiceChannelId);

      if (oldState.serverMute != newState.serverMute) {
        if (newState.serverMute) {
          console.log('Me Has been muted by server');
          this.dj.pause();
        } else {
          console.log('Me Has been unmuted by server');
          this.dj.start();
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
      state.audiences = without(state.audiences, newState.member.id);
      this.audiencesUpdated();
      return;
    }

    if (channelChange === 'join' || channelChange === 'move') {
      if (newState.channelId === state.voiceChannelId) {
        console.log(newState.member.displayName,'is joining or moving to my channel', 'deaf?', newState.deaf);
        if (!newState.deaf) {
          state.audiences.push(newState.member.id);
          this.audiencesUpdated();
        }

        return;
      }

      if (oldState.channelId === state.voiceChannelId) {
        console.log(newState.member.displayName, 'is moving away from my channel');
        state.audiences = without(state.audiences, newState.member.id);
        this.audiencesUpdated();

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

      this.audiencesUpdated();
    }
  }

  private audiencesUpdated() {
    console.log('Audiences updated');

    // TODO: Update bot activity
    // client.user?.setActivity('Artist - Title', { type: 'LISTENING' });

    for (const [guildId, state] of this.states) {
      if (!state.voiceChannelId) {
        state.audiences = [];
      }

      if (state.audiences.length > 0) {
        // has some audience
        this.dj.start();
        // TODO: Update bot activity
        return;
      }
    }

    // no audience, pause
    // TODO: Hide bot activity
    this.dj.pause();
  }

  private handleGuildCreate = async (guild: Guild) => {
    console.log('Invited into ', guild.name);

    this.ensureGuildState(guild.id)
    this.registerCommands(guild.id);
  }

  private handleGuildDelete = async (guild: Guild) => {
    console.log('Removed from guild', guild.name);
    this.states.delete(guild.id);
  }

  private async createTrackMessage(track: BoomBoxTrack): Promise<TrackMessage> {
    const embed = new MessageEmbed()
      .setColor('RANDOM')
      .setTitle('Playing');

    const { metadata } = track;

    let coverImage: MessageAttachment | undefined;

    if (metadata) {
      if (metadata.kind === TrackKind.Request) {
        embed.setTitle('Playing your request')
      }

      const { tags } = metadata;
      if (tags) {
        const { title, lyrics } = tags;

        if (title) {
          embed.setDescription(title);
        }

        for (const tag of ['artist', 'album', 'genre']) {
          const val = (tags as any)[tag];
          if (!isEmpty(val)) {
            embed.addField(capitalize(tag), `${val}`, true);
          }
        }

        const { picture: pictures } = tags;
        if (pictures?.length) {
          const picture = first(pictures);
          if (picture) {
            const { color } = colorableDominant(await splashy(picture.data).catch(() => []));

            if (color) {
              embed.setColor(color);
            }

            const ext = mime.extension(picture.format);
            coverImage = new MessageAttachment(picture.data, `cover.${ext}`);
          }
        }
      }
    } else {
      embed.setDescription(parsePath(track.path).name);
    }

    if (track.collection) {
      embed.addField('Collection', track.collection.id);
    }

    if (coverImage) {
      embed.setImage(`attachment://${coverImage.name}`)
    }

    const lyricButton = new MessageButton()
      .setLabel('Lyrics')
      .setStyle('SECONDARY')
      .setCustomId('b');

    const skipButton = new MessageButton()
      .setLabel('Skip')
      .setStyle('DANGER')
      .setCustomId('a');

    return {
      embed,
      coverImage,
      buttons: {
        lyric: lyricButton,
        skip: skipButton
      }
    };
  }

  private handleTrackStarted = async (track: BoomBoxTrack, lastTrack?: BoomBoxTrack) => {
    if (track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    // TODO: Update bot activity

    const msg = await this.createTrackMessage(track);

    const sentMessages = await this.sendAll({
      embeds: [msg.embed],
      files: msg.coverImage ? [msg.coverImage] : undefined,
      components: [
        new MessageActionRow()
          .addComponents(msg.buttons.lyric, msg.buttons.skip)
      ]
    });

    // TODO: Store message for each guild
    // Also update/delete old messages
  }

  private handleInteraction = async (interaction: Interaction) => {
    // Application commands
    if (interaction.isCommand()) {
      if (interaction.commandName !== 'medley') {
        return;
      }

      const group = interaction.options.getSubcommandGroup(false);
      return group ? this.handleGroupCommand(group, interaction) : this.handleTopLevelCommand(interaction.options.getSubcommand().toLowerCase(), interaction);
    }

    if (interaction.isButton()) {
      return this.handleButton(interaction);
    }
  }

  private handleTopLevelCommand = async (command: string, interaction: CommandInteraction) => {
    switch (command) {
      case 'join':
        return this.handleJoin(interaction);

      case 'volume':
        return this.handleVolume(interaction);

      case 'skip':
      case 'next':
        return this.handleSkip(interaction);
    }
  }

  private handleGroupCommand = async (group: string, interaction: CommandInteraction) => {

  }

  private handleButton = async (interaction: ButtonInteraction) => {
    const r = await interaction.reply({ content: 'Test' + interaction.customId, fetchReply: true });
    console.log(r);
  }

  private handleJoin = async (interaction: CommandInteraction) => {
    // TODO: Helper to check for permissions
    const hasPermission = interaction.memberPermissions?.any([
      Permissions.FLAGS.MANAGE_CHANNELS,
      Permissions.FLAGS.MANAGE_GUILD
    ]);

    // TODO: Check permission
    console.log('hasPermission', hasPermission);

    let error: string | undefined;
    let moved = false;

    const channel = interaction.options.getChannel('channel');

    if (channel) {
      const channelToJoin = this.client.channels.cache.get(channel.id);

      if (channelToJoin?.isVoice()) {
        await this.reply(interaction, `Joining ${channelToJoin}`);

        try {
          await this.dj.join(channelToJoin);

          const reply = `Joined ${channel}`;
          this.reply(interaction, {
            content: null,
            embeds: [
              new MessageEmbed()
                .setColor('DARK_RED')
                .setTitle(reply)
                .setDescription(reply)
                .addField('channel', channel?.toString())
            ]
          });
        }
        catch (e) {
          this.deny(interaction, 'Could not join');
        }
      }
    }
  }

  private handleVolume = async (interaction: CommandInteraction) => {
    const decibels = interaction.options.getNumber('db');
    if (decibels === null) {
      this.accept(interaction, `Current volume: ${gainToDecibels(this.dj.getGain(interaction.guildId))}dB`);
      return;
    }

    this.dj.setGain(interaction.guildId, decibelsToGain(decibels));
    this.accept(interaction, `OK, Volume set to ${decibels}dB`);
  }

  private handleSkip = async (interaction: CommandInteraction) => {
    if (!this.dj.playing) {
      await this.deny(interaction, 'Not currently playing');
      return;
    }

    // TODO: Deny if havn't joined a channel in this guild

    this.dj.skip();
    this.accept(interaction,'OK, Skipping to the next track');
  }

  private async reply(interaction: BaseCommandInteraction, options: string | MessagePayload | InteractionReplyOptions) {
    return (!interaction.replied)
      ? interaction.reply(options)
      : interaction.editReply(options);
  }

  private async accept(interaction: BaseCommandInteraction, s: string) {
    return this.reply(interaction, this.makeHighlightedMessage(s, HighlightTextType.Cyan));
  }


  private async deny(interaction: BaseCommandInteraction, s: string) {
    return this.reply(interaction, this.makeHighlightedMessage(s, HighlightTextType.Red));
  }

  /**
   * Send to all guilds
   */
  private async sendAll(options: string | MessagePayload | MessageOptions) {
    const results = await Promise.all(
      this.client.guilds.cache.mapValues(async (guild, id) => {
        const state = this.states.get(id);

        if (state) {
          // TODO: Configurable channel
          return guild.systemChannel?.send(options).catch(() => undefined)
        }
      })
    );

    return results;
  }

  private makeHighlightedMessage(s: string | string[], type: HighlightTextType) {
    const isRed = type === HighlightTextType.Red;
    return '```' + type + '\n' +
      castArray(s).map(line => (isRed ? '-' : '') + line).join('\n') + '\n' +
      '```'
    ;
  }

  static async registerCommands(botToken: string, clientId: string, guildId: string) {
    const client = new RestClient({ version: '9' })
      .setToken(botToken);

    await client.put(
      Routes.applicationGuildCommands(clientId, guildId),
      {
        body: [commands]
      }
    );

    console.log('Registered');
  }

  async registerCommands(guildId: string) {
    return MedleyAutomaton.registerCommands(this.options.botToken, this.options.clientId, guildId);
  }
}