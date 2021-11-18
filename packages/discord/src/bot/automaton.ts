/// <reference path="../types.d.ts" />

import { REST as RestClient } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import {
  ApplicationCommandOptionChoice,
  AutocompleteInteraction,
  BaseCommandInteraction,
  BaseGuildVoiceChannel,
  ButtonInteraction,
  Client,
  CommandInteraction,
  Guild,
  Intents,
  Interaction,
  InteractionReplyOptions,
  Message,
  MessageActionRow,
  MessageAttachment,
  MessageButton,
  MessageComponentInteraction,
  MessageEmbed,
  MessageOptions,
  MessagePayload,
  MessageSelectMenu,
  MessageSelectOptionData,
  PermissionResolvable,
  Permissions,
  SelectMenuInteraction,
  Snowflake,
  User,
  VoiceState
} from "discord.js";

import { BoomBoxTrack,
  BoomBoxTrackPlay,
  decibelsToGain,
  gainToDecibels,
  isRequestTrack,
  lyricsToText,
  parseLyrics,
  RequestTrack,
  TrackKind,
  TrackPeek
} from "@medley/core";

import colorableDominant from 'colorable-dominant';

import _, { capitalize, castArray, first, isEmpty, without } from "lodash";
import mime from 'mime-types';
import { parse as parsePath } from "path";
import splashy from 'splashy';
import commands from "./commands";
import { MedleyMix } from "./mix";
import lyricsSearcher from "lyrics-searcher";

export type MedleyAutomatonOptions = {
  clientId: string;
  botToken: string;
  // TODO: Use this
  owners?: Snowflake[];
}

export enum HighlightTextType {
  Cyan = 'yaml',
  Yellow = 'fix',
  Red = 'diff'
}

type AutomatonGuildState = {
  voiceChannelId?: BaseGuildVoiceChannel['id'];
  trackMessages: TrackMessage[];
  audiences: Snowflake[];
}

export enum TrackMessageStatus {
  Playing,
  Paused,
  Played,
  Skipped
}

type TrackMessage = {
  trackPlay: BoomBoxTrackPlay;
  status: TrackMessageStatus;
  embed: MessageEmbed;
  coverImage?: MessageAttachment;
  buttons: {
    skip?: MessageButton,
    lyric?: MessageButton
  };
  sentMessage?: Message;
  lyricMessage?: Message;
}

class CommandError extends Error { };

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
    this.dj.on('trackFinished', this.handleTrackFinished);
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

        state.voiceChannelId = newState.channelId || undefined;

        const { members } = newState.channel!;

        state.audiences = members
          .filter((member, id) => !member.user.bot && !newState.guild.voiceStates.cache.get(id)?.deaf)
          .map((member, id) => id);

        this.audiencesUpdated();

        if (state.audiences.length < 1) {
          console.log('No one is listening');
        }
      }

      if (oldState.serverMute != newState.serverMute) {
        if (newState.serverMute) {
          this.dj.pause();
          this.hideActivity();
        } else {
          this.dj.start();
          this.showActivity();
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
        console.log(newState.member.displayName, 'is joining or moving to my channel', 'deaf?', newState.deaf);
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

    for (const [guildId, state] of this.states) {
      if (!state.voiceChannelId) {
        state.audiences = [];
      }

      if (state.audiences.length > 0) {
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

  private getTrackBanner(track: BoomBoxTrack) {
    const tags = track.metadata?.tags;
    const info: string[] = [];

    if (tags?.artist) {
      info.push(tags.artist);
    }

    if (tags?.title) {
      info.push(tags.title);
    }

    return info.length ? info.join(' - ') : parsePath(track.path).name;
  }

  private showActivity() {
    const { user } = this.client;

    if (!user) {
      return;
    }

    const { trackPlay } = this.dj;
    const banner = trackPlay ? this.getTrackBanner(trackPlay.track) : 'Medley';

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
    this.states.delete(guild.id);
  }

  private async createTrackMessage(trackPlay: BoomBoxTrackPlay): Promise<TrackMessage> {
    const { track } = trackPlay;
    const requestedBy = isRequestTrack(track) ? track.requestedBy : undefined;

    const embed = new MessageEmbed()
      .setColor('RANDOM')
      .setTitle(requestedBy ? 'Playing your request' : 'Playing');

    const { metadata } = track;

    let coverImage: MessageAttachment | undefined;

    if (metadata) {
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

    if (requestedBy) {
      embed.addField('Requested by', `<@${requestedBy}>`);
    }

    if (coverImage) {
      embed.setImage(`attachment://${coverImage.name}`)
    }

    const lyricButton = new MessageButton()
      .setLabel('Lyrics')
      .setEmoji('📜')
      .setStyle('SECONDARY')
      .setCustomId(`lyric:${track.id}`);

    const skipButton = new MessageButton()
      .setLabel('Skip')
      .setEmoji('⛔')
      .setStyle('DANGER')
      .setCustomId(`skip:${trackPlay.uuid}`);

    return {
      trackPlay,
      status: TrackMessageStatus.Playing,
      embed,
      coverImage,
      buttons: {
        lyric: lyricButton,
        skip: skipButton
      }
    };
  }

  private trackMessageToMessageOptions(msg: TrackMessage): MessageOptions {
    const { lyric, skip } = msg.buttons;

    let actionRow: MessageActionRow | undefined = undefined;

    if (lyric || skip) {
      actionRow = new MessageActionRow();

      if (lyric) {
        actionRow.addComponents(lyric);
      }

      if (skip) {
        actionRow.addComponents(skip);
      }
    }

    return {
      embeds: [msg.embed],
      files: msg.coverImage ? [msg.coverImage] : undefined,
      components: actionRow ? [actionRow] : []
    }
  }

  private handleTrackStarted = async (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    this.showActivity();

    const trackMsg = await this.createTrackMessage(trackPlay);
    const sentMessages = await this.sendAll(this.trackMessageToMessageOptions(trackMsg));

    // Store message for each guild
    for (const [guildId, maybeMessage] of sentMessages) {
      const state = this.states.get(guildId);
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

  private handleTrackFinished = async (trackPlay: BoomBoxTrackPlay) => {
    this.updateTrackMessage(trackPlay, async msg => msg.status < TrackMessageStatus.Played, TrackMessageStatus.Played, 'Played');
  }

  private async updateTrackMessage(trackPlay: BoomBoxTrackPlay, predicate: (msg: TrackMessage) => Promise<boolean>, status: TrackMessageStatus, title?: string) {
    for (const state of this.states.values()) {
      const msg = state.trackMessages.find(msg => msg.status < TrackMessageStatus.Played && msg.trackPlay.uuid === trackPlay.uuid);

      if (msg) {
        if (await predicate(msg)) {
          msg.status = status;
          if (title) {
            msg.embed.setTitle(title);
          }

          const showSkipButton = status < TrackMessageStatus.Played;

          if (showSkipButton || title) {
            const { sentMessage } = msg;
            if (sentMessage?.editable) {
              sentMessage.edit(this.trackMessageToMessageOptions({
                ...msg,
                buttons: {
                  lyric: msg.buttons.lyric,
                  skip: showSkipButton ? msg.buttons.skip : undefined
                }
              }));
            }
          }
        }
      }
    }
  }

  private async removeLyricsButton(trackId: BoomBoxTrack['id']) {
    for (const state of this.states.values()) {

      const messages = state.trackMessages.filter(msg => msg.trackPlay.track.id === trackId);
      for (const msg of messages) {
        msg.buttons.lyric = undefined;

        const showSkipButton = msg.status < TrackMessageStatus.Played;

        const { sentMessage } = msg;
        if (sentMessage?.editable) {
          sentMessage.edit(this.trackMessageToMessageOptions({
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

  private permissionGuard(permissions: Permissions | null, perm: PermissionResolvable, checkAdmin: boolean = true) {
    if (permissions && !permissions?.any(perm, checkAdmin)) {
      throw new CommandError('Insufficient permissions');
    }
  }

  private handleInteraction = async (interaction: Interaction) => {
    if (interaction.user.bot) {
      return;
    }

    try {
      // Application commands
      if (interaction.isCommand()) {
        if (interaction.commandName !== 'medley') {
          return;
        }

        const group = interaction.options.getSubcommandGroup(false);
        const promise = group ? this.handleGroupCommand(group.toLowerCase(), interaction) : this.handleTopLevelCommand(interaction.options.getSubcommand().toLowerCase(), interaction);
        return await promise;
      }

      if (interaction.isButton()) {
        return await this.handleButton(interaction);
      }

      if (interaction.isAutocomplete()) {
        if (interaction.commandName !== 'medley') {
          return;
        }

        return await this.handleAutoComplete(interaction.options.getSubcommand().toLowerCase(), interaction);
      }

      if (interaction.isSelectMenu()) {
        return await this.handleSelectMenu(interaction);
      }

    }
    catch (e) {
      if (e instanceof CommandError) {
        if (interaction.isApplicationCommand() || interaction.isMessageComponent()) {
          this.deny(interaction, `Command Error: ${e.message}`, undefined, true);
        }
      } else {
        console.error('Interaction Error', e);
      }
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

      case 'request':
        return this.handleRequest(interaction);
    }
  }

  private handleGroupCommand = async (group: string, interaction: CommandInteraction) => {

  }

  private handleButton = async (interaction: ButtonInteraction) => {
    const { customId } = interaction;

    const matched = customId.match(/^(.*)\:(.*)$/);
    if (!matched) {
      return;
    }

    const [, tag, value] = matched;

    switch (tag.toLowerCase()) {
      case 'skip':
        return this.handleSkipButton(interaction, value);

      case 'lyric':
        return this.handleLyricsButton(interaction, value);
    }
  }

  private handleJoin = async (interaction: CommandInteraction) => {
    this.permissionGuard(interaction.memberPermissions, [
      Permissions.FLAGS.MANAGE_CHANNELS,
      Permissions.FLAGS.MANAGE_GUILD
    ]);

    const channel = interaction.options.getChannel('channel');

    if (!channel) {
      return;
    }

    const channelToJoin = this.client.channels.cache.get(channel.id);

    if (!channelToJoin?.isVoice()) {
      return;
    }

    await this.reply(interaction, `Joining ${channelToJoin}`);

    try {
      await this.dj.join(channelToJoin);

      this.reply(interaction, {
        content: null,
        embeds: [
          new MessageEmbed()
            .setColor('RANDOM')
            .setTitle('Joined')
            .addField('channel', channel?.toString())
        ]
      });
    }
    catch (e) {
      this.deny(interaction, 'Could not join');
    }
  }

  private handleVolume = async (interaction: CommandInteraction) => {
    const decibels = interaction.options.getNumber('db');
    if (decibels === null) {
      this.accept(interaction, `Current volume: ${gainToDecibels(this.dj.getGain(interaction.guildId))}dB`);
      return;
    }

    this.dj.setGain(interaction.guildId, decibelsToGain(decibels));
    this.accept(interaction, `OK: Volume set to ${decibels}dB`);
  }

  private handleSkip = async (interaction: CommandInteraction | ButtonInteraction, trackPlay?: BoomBoxTrackPlay) => {
    this.permissionGuard(interaction.memberPermissions, [
      Permissions.FLAGS.MANAGE_CHANNELS,
      Permissions.FLAGS.MANAGE_GUILD,
      Permissions.FLAGS.MOVE_MEMBERS
    ]);

    if (trackPlay && isRequestTrack(trackPlay.track)) {
      const { requestedBy } = trackPlay.track;

      if (requestedBy && requestedBy !== interaction.user.id) {
        await this.reply(interaction, `<@${interaction.user.id}> Could not skip this track, it was requested by <@${requestedBy}>`);
        return;
      }
    }

    if (this.dj.paused || !this.dj.playing) {
      await this.deny(interaction, 'Not currently playing', `@${interaction.user.id}`);
      return;
    }

    this.skipCurrentSong();
    this.accept(interaction, `OK: Skipping to the next track`, `@${interaction.user.id}`);
  }

  private skipCurrentSong() {
    if (!this.dj.paused && this.dj.playing) {
      const { trackPlay } = this.dj;
      if (trackPlay) {
        this.updateTrackMessage(trackPlay, async () => true, TrackMessageStatus.Skipped, 'Skipped');
      }

      this.dj.skip();
    }
  }

  private handleSkipButton = async (interaction: ButtonInteraction, playUuid: string) => {
    if (this.dj.trackPlay?.uuid !== playUuid) {
      this.deny(interaction, 'Could not skip this track', undefined, true);
      return;
    }

    return this.handleSkip(interaction, this.dj.trackPlay);
  }

  private handleLyricsButton = async (interaction: ButtonInteraction, trackId: BoomBoxTrack['id']) => {
    const track = this.dj.findTrackById(trackId);
    if (!track) {
      this.deny(interaction, 'Invalid track identifier', undefined, true);
      return;
    }

    const state = this.states.get(interaction.guildId);

    const trackMsg = state ? _.findLast(state.trackMessages, m => m.trackPlay.track.id === trackId) : undefined;

    if (!trackMsg) {
      this.warn(interaction, 'Track has been forgotten');
      return;
    }

    const banner = this.getTrackBanner(track);

    if (trackMsg?.lyricMessage) {
      const referringMessage = await trackMsg.lyricMessage.reply({
        content: `${interaction.member} Lyrics for \`${banner}\` is right here ↖`,
      });

      setTimeout(() => referringMessage.delete(), 10_000);

      await interaction.reply('.');
      await interaction.deleteReply();
      return;
    }

    let lyricsText: string | undefined = undefined;
    let lyricsSource = 'N/A';

    const lyrics = first(track.metadata?.tags?.lyrics);

    if (lyrics) {
      lyricsText = lyricsToText(parseLyrics(lyrics), false).join('\n');
      lyricsSource = 'metadata';

    } else {
      const artist = track.metadata?.tags?.artist;
      const title = track.metadata?.tags?.title;

      if (artist && title) {
        await interaction.deferReply();
        lyricsText = await lyricsSearcher(artist, title).catch(() => undefined);
        lyricsSource = 'Google';
      }
    }

    if (!lyricsText) {
      this.warn(interaction, 'No lyrics');
      this.removeLyricsButton(trackId);
      return
    }


    const lyricMessage = await this.reply(interaction, {
      embeds: [
        new MessageEmbed()
          .setTitle('Lyrics')
          .setDescription(banner)
          .addField('Requested by', `${interaction.member}`, true)
          .addField('Source', lyricsSource, true)
      ],
      files: [
        new MessageAttachment(Buffer.from(lyricsText), 'lyrics.txt')
      ],
      fetchReply: true
    });


    if (trackMsg && lyricMessage instanceof Message) {
      trackMsg.lyricMessage = lyricMessage;
    }
  }

  private handleRequest = async (interaction: CommandInteraction) => {
    const options = ['artist', 'title', 'query'].map(f => interaction.options.getString(f));

    if (options.every(_.isNull)) {
      const preview = await this.makeRequestPreview();

      if (preview) {
        interaction.reply(preview.join('\n'))
      } else {
        interaction.reply('Request list is empty');
      }

      return;
    }

    await interaction.deferReply();

    const [artist, title, query] = options;

    const results = this.dj.search({
      artist,
      title,
      query
    }, 10);

    if (results.length < 1) {
      const tagTerms = _.zip(['artist', 'title'], [artist, title])
        .filter(([, t]) => !!t)
        .map(([n, v]) => `(${n} ~ "${v}")`)
        .join(' AND ');

      const queryString = [tagTerms, query ? `"${query}"` : null]
        .filter(t => !!t)
        .join(' OR ');

      this.reply(interaction, `Your search **\`${queryString}\`** did not match any tracks`)
      return;
    }

    const issuer = interaction.user.id;

    const selections = results.map<MessageSelectOptionData & { collection: BoomBoxTrack['collection'] }>(track => ({
      label: track.metadata?.tags?.title || parsePath(track.path).name,
      description: track.metadata?.tags?.title ? (track.metadata?.tags?.artist || 'Unknown Artist') : undefined,
      value: track.id,
      collection: track.collection
    }));

    // Distinguish duplicated track artist and title
    _(selections)
      .groupBy(({ label, description }) => `${label}:${description}`)
      .pickBy(group => group.length > 1)
      .forEach(group => {
        for (const sel of group) {
          sel.description += ` (from \'${sel.collection.id}\' collection)`
        }
      });

    const selector = await this.reply(interaction, {
      content: 'Search result:',
      components: [
        new MessageActionRow()
          .addComponents(
            new MessageSelectMenu()
              .setCustomId('request')
              .setPlaceholder('Select a track')
              .addOptions(selections)
          ),
        new MessageActionRow()
          .addComponents(
            new MessageButton()
              .setCustomId('cancel_request')
              .setLabel('Cancel')
              .setStyle('SECONDARY')
              .setEmoji('❌')
          )
      ],
      fetchReply: true
    });

    if (selector instanceof Message) {
      const collector = selector.createMessageComponentCollector({ componentType: 'SELECT_MENU', time: 30_000 });

      collector.on('collect', async i => {
        if (i.user.id !== issuer) {
          i.reply({
            content: `Sorry, this selection is for <@${issuer}> only`,
            ephemeral: true
          })
          return;
        }

        collector.removeAllListeners();
        await this.handleSelectMenuForRequest(i);
      });

      collector.on('end', () => {
        if (selector.editable) {
          selector.edit({
            content: this.makeHighlightedMessage('Timed out, please try again', HighlightTextType.Yellow),
            components: []
          });
        }
      });

      selector.awaitMessageComponent({
        componentType: 'BUTTON',
        filter: (i) => {
          i.deferUpdate();
          return i.user.id === issuer;
        },
        time: 60_000
      })
      .then(_.identity)
      .catch(() => void 0)
      .finally(() => {
        collector.removeAllListeners();
        selector.delete();
      });
    }
  }

  private handleAutoComplete = async (command: string, interaction: AutocompleteInteraction) => {
    switch (command) {
      case 'request':
        return this.handleAutoCompleteForRequest(interaction);
    }

    interaction.respond([]);
  }

  private handleAutoCompleteForRequest = async (interaction: AutocompleteInteraction) => {
    const { name, value } = interaction.options.getFocused(true);

    const completions = value ? _(this.dj.autoSuggest(`${value}`, ['artist', 'title'].includes(name) ? name : undefined))
      .take(25)
      .map<ApplicationCommandOptionChoice>(s => ({ name: s, value: s }))
      .value()
      : []

    // TODO: return some suggestion if query is empty, from search history?, request history?

    interaction.respond(completions);
  }

  private handleSelectMenu = async (interaction: SelectMenuInteraction) => {

  }

  private async makeRequestPreview(index: number = 0, focus?: number) {
    const peeking = this.dj.peekRequests(index, 5);

    if (peeking.length <= 0) {
      return;
    }

    const padding = 2 + (_.maxBy(peeking, 'index')?.index.toString().length || 0);

    const previewTrack = (focus?: number) => ({ index, track }: TrackPeek<RequestTrack<User['id']>>) => {
      const label = _.padStart(`${focus === index ? '+ ' : ''}${index + 1}`, padding);
      return `${label}: ${this.getTrackBanner(track)} [${track.priority || 0}]`;
    };

    const lines: string[] = [];

    if (peeking[0].index > 1) {
      const first = this.dj.peekRequests(0, 1);
      if (first.length) {
        lines.push(previewTrack(focus)(first[0]));
        lines.push(_.padStart('...', padding));
      }
    }

    for (const peek of peeking) {
      lines.push(previewTrack(focus)(peek));
    }

    return lines.length
      ? [
        '```diff',
        ...lines,
        '```'
      ]
      : undefined;
  }

  private handleSelectMenuForRequest = async (interaction: SelectMenuInteraction) => {
    const { values } = interaction;
    if (values.length) {
      const trackId = values[0];
      if (trackId) {
        const ok = await this.dj.request(trackId, interaction.member.user.id);

        if (ok === false || ok.index < 0) {
          await interaction.update({
            content: this.makeHighlightedMessage('Track could not be requested for some reasons', HighlightTextType.Red),
            components: []
          });
          return;
        }

        const preview = await this.makeRequestPreview(ok.index, ok.index);
        await interaction.update({
          content: `Request accepted: \`${this.getTrackBanner(ok.track)}\``,
          components: []
        });

        if (preview) {
          interaction.followUp({
            content: preview.join('\n')
          })
        }
      }
    }
  }

  private async reply(interaction: BaseCommandInteraction | MessageComponentInteraction, options: string | MessagePayload | InteractionReplyOptions) {
    return (!interaction.replied && !interaction.deferred)
      ? interaction.reply(options)
      : interaction.editReply(options);
  }

  private async declare(interaction: BaseCommandInteraction | MessageComponentInteraction, type: HighlightTextType, s: string, mention?: string, ephemeral?: boolean) {
    return this.reply(interaction, {
      content: this.makeHighlightedMessage(s, type, mention),
      ephemeral
    });
  }

  private async accept(interaction: BaseCommandInteraction | MessageComponentInteraction, s: string, mention?: string, ephemeral?: boolean) {
    return this.declare(interaction, HighlightTextType.Cyan, s, mention, ephemeral);
  }

  private async deny(interaction: BaseCommandInteraction | MessageComponentInteraction, s: string, mention?: string, ephemeral?: boolean) {
    return this.declare(interaction, HighlightTextType.Red, s, mention, ephemeral);
  }

  private async warn(interaction: BaseCommandInteraction | MessageComponentInteraction, s: string, mention?: string, ephemeral?: boolean) {
    return this.declare(interaction, HighlightTextType.Yellow, s, mention, ephemeral);
  }

  /**
   * Send to all guilds
   */
  private async sendAll(options: string | MessagePayload | MessageOptions) {
    const results = await Promise.all(
      this.client.guilds.cache.mapValues(async (guild, id) => {
        const state = this.states.get(id);

        if (state?.voiceChannelId) {
          // TODO: Configurable channel
          return guild.systemChannel?.send(options).catch(() => undefined)
        }
      })
    );

    return results;
  }

  private makeHighlightedMessage(s: string | string[], type: HighlightTextType, mention?: string) {
    const isRed = type === HighlightTextType.Red;
    return (mention ? `<${mention}>` : '') +
      '```' + type + '\n' +
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