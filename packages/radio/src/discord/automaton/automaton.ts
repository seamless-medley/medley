import { OAuth2Scopes, PermissionFlagsBits } from "discord-api-types/v10";

import {
  REST, Routes,
  Client, Guild,
  GatewayIntentBits, Message,
  OAuth2Guild,
  Snowflake, ChannelType, PermissionsBitField, PartialMessage, TextChannel, MessageReaction, PartialMessageReaction, Emoji
} from "discord.js";

import {
  IReadonlyLibrary, TrackKind,
  Station,
  makeAudienceGroupId as makeStationAudienceGroup,
  AudienceGroupId,
  AudienceType,
  extractAudienceGroupFromId,
  DeckIndex,
  StationEvents,
  StationTrack,
  StationTrackPlay,
} from "@seamless-medley/core";

import { TypedEmitter } from 'tiny-typed-emitter';

import { createCommandDeclarations, createInteractionHandler } from "../command";

import { retryable, waitFor } from "@seamless-medley/utils";
import { TrackMessage, TrackMessageStatus } from "../trackmessage/types";
import { trackMessageToMessageOptions } from "../trackmessage";
import { GuildState, GuildStateAdapter, JoinResult } from "./guild-state";
import { AudioDispatcher } from "../../audio/exciter";
import { CreatorNames } from "../trackmessage/creator";
import { Logger, createLogger } from "@seamless-medley/logging";

export type GuildSpecificConfig = {
  autotune?: string;
  autojoin?: string;

  trackMessage?: {
    /**
     * @default extended
     */
    type?: CreatorNames;

    /**
     * @default 3
     */
    max?: number;

    channel?: string;

    retainOnReaction?: boolean;

    /**
     * Always received track messages even if there aren't any audiences.
     */
    always?: boolean;
  }

  /**
   * Opus bitrate, in kbps
   */
  bitrate: number;
}

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
   * Guild specific settings
   */
  guilds?: Partial<Record<string, GuildSpecificConfig>>;
}

export type UpdateTrackMessageOptions = {
  status?: TrackMessageStatus;
  title?: string;
  showLyrics?: boolean;
  showMore?: boolean;
  showSkip?: boolean;
}

export type RegisterOptions = {
  guild: Guild | OAuth2Guild;
  clientId: string;
  botToken: string;
  baseCommand: string;
  logger: Logger;
}

export type AutomatonEvents = {
  ready: () => void;

  guildCreate: (guild: Guild) => void;
  guildDelete: (guild: Guild) => void;

  stationTuned: (guildId: string, oldStation: Station | undefined, newStation: Station) => void;
}

export class MedleyAutomaton extends TypedEmitter<AutomatonEvents> {
  readonly id: string;

  botToken: string;
  clientId: string;

  owners: Snowflake[] = [];

  #baseCommand: string;

  #client: Client;

  #guildConfigs: NonNullable<MedleyAutomatonOptions['guilds']>;

  #guildStates: Map<Guild['id'], GuildState> = new Map();

  #logger: Logger;

  #rejoining = false;

  #shardReady = false;

  #audioDispatcher: AudioDispatcher;

  constructor(readonly stations: IReadonlyLibrary<Station>, options: MedleyAutomatonOptions) {
    super();

    this.#logger = createLogger({ name: 'automaton', id: options.id });

    this.id = options.id;
    this.botToken = options.botToken;
    this.clientId = options.clientId;
    this.owners = options.owners || [];
    this.#guildConfigs = options.guilds || {};

    this.#baseCommand = options.baseCommand || 'medley';

    this.#audioDispatcher = new AudioDispatcher();

    this.#client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    this.#client.on('warn', message => {
      this.#logger.warn(`Automaton Warning ${message}`);
    });

    this.#client.on('error', (error) => {
      this.#logger.error(error, 'Automaton Error');
    });

    this.#client.on('shardError', this.#handleShardError);

    this.#client.on('shardReconnecting', (shardId) => {
      this.#logger.debug(`Shard ${shardId}, reconnecting`);
    })

    this.#client.on('shardResume', (shardId) => {
      this.#logger.debug(`Shard ${shardId}, resume`);

      if (!this.#shardReady) {
        this.#rejoinVoiceChannels(30);
      }

      this.#shardReady = true;
    });

    this.#client.on('shardReady', (shardId) => {
      this.#shardReady = true;
      this.#logger.debug(`Shard ${shardId}, ready`);
      this.#rejoinVoiceChannels(30);
    })

    this.#client.on('ready', this.#handleClientReady);
    this.#client.on('guildCreate', this.#handleGuildCreate);
    this.#client.on('guildDelete', this.#handleGuildDelete);
    this.#client.on('interactionCreate', createInteractionHandler(this));

    this.#client.on('messageDelete', this.#handleMessageDeletion);
    this.#client.on('messageDeleteBulk', async messages => void messages.mapValues(this.#handleMessageDeletion));

    this.#client.on('messageReactionAdd', message => this.#handleMessageReaction(message, 'add'));
    this.#client.on('messageReactionRemove', message => this.#handleMessageReaction(message, 'remove'));
    this.#client.on('messageReactionRemoveEmoji', message => this.#handleMessageReaction(message, 'remove'));
    this.#client.on('messageReactionRemoveAll', this.#handleMessageReactionRemoveAll);

    for (const station of stations) {
      station.on('trackStarted', this.#handleTrackStarted(station));
      station.on('trackActive', this.#handleTrackActive);
      station.on('trackFinished', this.#handleTrackFinished);
      station.on('collectionChange', this.#handleCollectionChange(station));
    }

    this.#logger.info('OAUthURL: %s', this.oAuth2Url.toString());

    this.#client.once('ready', async () => {
      for (const guildId of Object.keys(this.#guildConfigs)) {
        this.#autoTuneStation(guildId);
        this.#autoJoinVoiceChannel(guildId);
      }
    });
  }

  get client() {
    return this.#client;
  }

  get baseCommand() {
    return this.#baseCommand || 'medley';
  }

  #handleShardError = (error: Error, shardId: number) => {
    this.#logger.error(error, `Shard ${shardId} error`);

    this.#shardReady = false;
    this.#rejoining = false;
    this.#removeAllAudiences();
  }

  #removeAllAudiences(closeConnection?: boolean) {
    // Remove audiences from all stations
    for (const [guildId, state] of this.#guildStates) {
      const group = this.makeAudienceGroup(guildId);

      for (const station of this.stations) {
        station.removeAudiencesForGroup(group)
      }

      if (closeConnection) {
        state.destroyVoiceConnector();
      }
    }
  }

  async #autoTuneStation(guildId: string) {
    const config = this.#guildConfigs[guildId];

    if (!config?.autotune) {
      return;
    }

    const state = this.ensureGuildState(guildId);

    state.preferredStation = this.stations.get(config?.autotune);

    if (state.preferredStation) {
      await state.createStationLink();
    }
  }

  async #autoJoinVoiceChannel(guildId: string) {
    const config = this.#guildConfigs[guildId];

    if (!config?.autojoin) {
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);

    if (!guild) {
      return;
    }

    const voiceChannel = guild.channels.cache.get(config.autojoin);
    if (voiceChannel?.isVoiceBased()) {
      const { status } = await this.ensureGuildState(guildId).join(voiceChannel, 5_000, 5);
      this.#logger.info(
        { status, guild: guild.name, channel: voiceChannel.name },
        'Auto join result'
      )
    }
  }

  async #rejoinVoiceChannels(timeoutSeconds: number) {
    if (this.#rejoining) {
      return;
    }

    const joinTimeout = 5000;

    for (const [guildId, state] of this.#guildStates) {

      const { voiceChannelId } = state;

      if (!voiceChannelId) {
        continue;
      }

      const channel = this.client.channels.cache.get(voiceChannelId);

      if (!channel?.isVoiceBased()) {
        continue;
      }

      if (!state.hasVoiceConnection()) {
        continue;
      }

      this.#rejoining = true;

      const retries = Math.ceil(timeoutSeconds * 1000 / (joinTimeout + 1000));

      retryable<JoinResult>(async () => {
        if (!this.#rejoining) {
          return { status: 'not_joined' }
        }

        const result = await state.join(channel, joinTimeout);

        if (result.status !== 'joined') {
          throw new Error('Rejoin again');
        }

        this.#rejoining = false;
        this.#logger.info({ guild: channel.guild.name, channel: channel.name }, 'Rejoined');

        return result;
      }, { retries, wait: 1000 }).then(() => state.preferredStation?.updatePlayback());
    }
  }

  get isReady() {
    return this.client.isReady();
  }

  #loginAbortController: AbortController | undefined;

  async login() {
    this.#loginAbortController?.abort();
    this.#loginAbortController = new AbortController();

    try {
      const result = await retryable(async () => {
        this.#logger.info('Login');

        return this.client.login(this.botToken);
      }, { wait: 5000, signal: this.#loginAbortController.signal });

      if (result !== undefined) {
        this.#logger.info('Login OK');
      }
    }
    catch (e) {
      this.#logger.error(e, 'Login error');
    }
  }

  #baseAdapter: Omit<GuildStateAdapter, 'getChannel'> = {
    getAutomaton: () => this,
    getClient: () => this.client,
    getLogger: () => this.#logger,
    getStations: () => this.stations,
    getAudioDispatcher: () => this.#audioDispatcher,
    getConfig: (guildId) => this.#guildConfigs[guildId],
    makeAudienceGroup: (guildId: string) => this.makeAudienceGroup(guildId),
  }

  #makeAdapter(guildId: Guild['id']): GuildStateAdapter {
    return ({
      ...this.#baseAdapter,
      getChannel: (id) => this.client.guilds.cache.get(guildId)?.channels.cache.get(id)
    });
  }

  ensureGuildState(guildId: Guild['id']) {
    if (!this.#guildStates.has(guildId)) {
      this.#guildStates.set(guildId, new GuildState(guildId, this.#makeAdapter(guildId)));
    }

    return this.#guildStates.get(guildId)!;
  }

  getGuildState(id: Guild['id']): GuildState | undefined {
    return this.#guildStates.get(id);
  }

  #handleClientReady = async (client: Client) => {
    const guilds = [...(await client.guilds.fetch()).values()];

    for (const { id } of guilds) {
      this.ensureGuildState(id);
    };

    this.#logger.info('Ready');
    this.emit('ready');
  }

  #handleGuildCreate = async (guild: Guild) => {
    // Invited to
    this.#logger.info(`Invited to ${guild.name}`);

    this.ensureGuildState(guild.id)
    this.#autoJoinVoiceChannel(guild.id);

    MedleyAutomaton.registerCommands(({
      guild,
      botToken: this.botToken,
      clientId: this.clientId,
      baseCommand: this.baseCommand,
      logger: this.#logger
    }));

    guild?.systemChannel?.send(`Greetings :notes:, use \`/${this.baseCommand} join\` command to invite me to a voice channel`);

    this.emit('guildCreate', guild);
  }

  #handleGuildDelete = async (guild: Guild) => {
    // Removed from
    this.#logger.info(`Removed from ${guild.name}`);
    this.#guildStates.get(guild.id)?.dispose();
    this.#guildStates.delete(guild.id);

    this.emit('guildDelete', guild);
  }

  #handleTrackStarted = (station: Station): StationEvents['trackStarted'] => async (deck: DeckIndex, trackPlay, lastTrackPlay) => {
    if (trackPlay.track.extra?.kind !== TrackKind.Insertion) {
      const sentMessages = await this.#sendTrackPlayForStation(trackPlay, deck, station);

      // Store message for each guild
      for (const [guildId, trackMsg, maybeMessage] of sentMessages) {
        const state = this.#guildStates.get(guildId);

        if (!state) {
          continue;
        }

        const guildConfig = this.#guildConfigs[guildId];

        state.trackMessages.push({
          ...trackMsg,
          maybeMessage
        });

        if (state.trackMessages.length > state.maxTrackMessages) {
          const oldMessages = state.trackMessages.splice(0, state.trackMessages.length - state.maxTrackMessages);

          for (const { maybeMessage, lyricMessage, reactions } of oldMessages) {
            if (guildConfig?.trackMessage?.retainOnReaction && reactions?.size) {
              continue;
            }

            maybeMessage?.then((sentMessage) => {
              if (sentMessage?.deletable) {
                sentMessage.delete();
              }
            });

            if (lyricMessage?.deletable) {
              lyricMessage.delete();
            }
          }
        }
      }
    }

    // Hide all button from old playing track as soon as this new track has started
    this.updateTrackMessage(async (msg) => {
      // Skip this track that has just started
      if (msg.trackPlay.uuid === trackPlay.uuid) {
        return;
      }

      // Only if its status is "Playing"
      if (msg.status !== TrackMessageStatus.Playing) {
        return;
      }

      return {
        status: TrackMessageStatus.Ending,
        title: 'Ending',
        showMore: false,
        showSkip: false,
        showLyrics: false
      }
    });
  }

  #handleTrackActive: StationEvents['trackActive'] = async (deck, trackPlay) => {
    await waitFor(1000);

    // Reveal all buttons for this trackPlay
    this.updateTrackMessage(async (msg) => {
      if (msg.trackPlay.uuid !== trackPlay.uuid) {
        return;
      }

      if (msg.status >= TrackMessageStatus.Ending) {
        return;
      }

      return  {
        showSkip: true,
        showLyrics: true,
        showMore: true
      }
    });
  }

  #handleTrackFinished: StationEvents['trackFinished'] = (deck, trackPlay) => {
    // Update this trackPlay status to "Played"
    this.updateTrackMessage(async (msg) => {
      // Only update this trackPlay if it is neither played nor skipped
      if (msg.trackPlay.uuid !== trackPlay.uuid || msg.status >= TrackMessageStatus.Played) {
        return;
      }

      return {
        status: TrackMessageStatus.Played,
        title: 'Played',
        showMore: false,
        showSkip: false,
        showLyrics: false
      }
    });
  }

  #handleCollectionChange = (station: Station): StationEvents['collectionChange'] => (oldCollection, newCollection) => {
    // Hide "more like this" button for this currently playing track
    this.updateTrackMessage(
      async (msg) =>  {
        if (msg.station !== station) {
          return;
        }

        const isEndingOrPlaying = (msg.status >= TrackMessageStatus.Playing) && (msg.status <= TrackMessageStatus.Ending);

        if (!isEndingOrPlaying) {
          return;
        }

        return {
          showMore: msg.trackPlay.track.collection.id === newCollection.id,
          showSkip: true,
          showLyrics: true
        }
      }
    )
  }

  #handleMessageDeletion = (message: Message<boolean> | PartialMessage) => {
    const { guildId } = message;

    if (!message.inGuild || !guildId) {
      return;
    }

    const state = this.getGuildState(guildId);

    if (!state) {
      return;
    }

    const { trackMessages } = state;

    for (const trackMessage of [...trackMessages]) {
      if (message.id === trackMessage.lyricMessage?.id) {
        trackMessage.lyricMessage = undefined;
      }

      trackMessage.maybeMessage?.then(sentMessage => {
        if (sentMessage?.id === message.id)  {
          trackMessage.maybeMessage = undefined;
        }
      });
    }
  }

  #manipulateTrackMessageReactions(trackMessage: TrackMessage, action: 'add' | 'remove' | 'remove-all', emoji?: Emoji) {
    if (action === 'remove-all') {
      trackMessage.reactions = undefined;
      return;
    }

    const emojiId = emoji?.id ?? emoji?.name;

    if (!emojiId) {
      return;
    }

    if (action === 'add' && !trackMessage.reactions) {
      trackMessage.reactions = new Set();
    }

    switch (action) {
      case 'add':
        trackMessage.reactions?.add(emojiId);
        return;

      case 'remove':
        trackMessage.reactions?.delete(emojiId);
        return;
    }
  }

  #handleMessageReactionRemoveAll = (message: Message<boolean> | PartialMessage) => {
    const { guildId } = message;

    if (!message.inGuild || !guildId) {
      return;
    }

    const state = this.getGuildState(guildId);

    if (!state) {
      return;
    }

    const { trackMessages } = state;

    for (const trackMessage of [...trackMessages]) {
      if (trackMessage.lyricMessage?.id === message.id) {
        this.#manipulateTrackMessageReactions(trackMessage, 'remove-all');
        continue;
      }

      trackMessage.maybeMessage?.then(sentMessage => {
        if (sentMessage?.id === message.id) {
          this.#manipulateTrackMessageReactions(trackMessage, 'remove-all');
        }
      });
    }
  }

  #handleMessageReaction = async (reaction: MessageReaction | PartialMessageReaction, action: 'add' | 'remove') => {
    const { message, emoji } = reaction;

    const { guildId } = message;

    if (!message.inGuild || !guildId) {
      return;
    }

    const state = this.getGuildState(guildId);

    if (!state) {
      return;
    }

    const { trackMessages } = state;

    for (const trackMessage of [...trackMessages]) {
      if (trackMessage.lyricMessage?.id === message.id) {
        this.#manipulateTrackMessageReactions(trackMessage, action, emoji);
        continue;
      }

      trackMessage.maybeMessage?.then(sentMessage => {
        if (sentMessage?.id === message.id) {
          this.#manipulateTrackMessageReactions(trackMessage, action, emoji);
        }
      });
    }
  }

  async tune(guildId: string, station: Station) {
    return this.ensureGuildState(guildId).tune(station);
  }

  async updateTrackMessage(predicate: (msg: TrackMessage) => Promise<UpdateTrackMessageOptions | undefined>) {
    let count = 0;

    for (const state of this.#guildStates.values()) {
      for (const msg of state.trackMessages) {
        const options = await predicate(msg);

        if (options === undefined) {
          continue;
        }

        const { status: newStatus, title: newTitle, showMore, showSkip, showLyrics } = options;

        if (newStatus) {
          msg.status = newStatus;
        }

        if (newTitle) {
          msg.embed.setTitle(newTitle);
        }

        const { maybeMessage, buttons } = msg;

        maybeMessage?.then((sentMessage) => {
          if (!sentMessage?.editable) {
            return;
          }

          const { embeds, components } = trackMessageToMessageOptions({
            ...msg,
            buttons: {
              more: showMore ? buttons.more : undefined,
              lyric: showLyrics ? buttons.lyric : undefined,
              skip: showSkip ? buttons.skip : undefined
            }
          });

          new Promise(async (resolve) => {
            if (count++ >= 3) {
              await waitFor(200);
            }

            sentMessage.edit({ embeds, components })
              .then(resolve)
              .catch((error) => {
                this.#logger.error(error, 'Error updating track message in guild %s', sentMessage.guild?.name);
              });
          });
        })
      }
    }
  }

  async removeLyricsButton(trackId: StationTrack['id']) {
    for (const state of this.#guildStates.values()) {
      const currentCollectionId = state.tunedStation?.trackPlay?.track?.collection?.id;

      const messages = state.trackMessages.filter(msg => msg.trackPlay.track.id === trackId);
      for (const msg of messages) {
        msg.buttons.lyric = undefined;

        const showSkipButton = msg.status < TrackMessageStatus.Played;

        const { maybeMessage } = msg;

        const showMore = currentCollectionId !== undefined
          && currentCollectionId === msg.trackPlay.track.collection.id;

        maybeMessage?.then((sentMessage) => {
          if (sentMessage?.editable) {
            const { embeds, components } = trackMessageToMessageOptions({
              ...msg,
              buttons: {
                lyric: undefined,
                more: showMore ? msg.buttons.more : undefined,
                skip: showSkipButton ? msg.buttons.skip : undefined,
              }
            });

            sentMessage.edit({ embeds, components });
          }
        })
      }
    }
  }

  skipCurrentSong(guildId: Guild['id']) {
    const station = this.getGuildState(guildId)?.tunedStation;

    if (!station) {
      this.#logger.warn({ guildId }, 'Deny skipping: no station');
      return false;
    }

    if (station.paused || !station.playing) {
      this.#logger.warn({ guildId }, 'Deny skipping: not playing');
      return false;
    }

    const { trackPlay } = station;

    if (!trackPlay) {
      this.#logger.warn({ guildId }, 'Deny skipping: no track play');
      return false;
    }

    if (!station.skip()) {
      this.#logger.warn({ guildId }, 'Deny skipping: denied by engine');
      return false;
    }

    this.updateTrackMessage(
      async (msg) => {
        if (trackPlay.uuid !== msg.trackPlay.uuid) {
          return;
        }

        return {
          title: 'Skipped',
          status: TrackMessageStatus.Skipped,
          showSkip: false,
          showMore: false,
          showLyrics: false
        }
      }
    );

    return true;
  }

  /**
   * Make audience group for Discord based on automatonId and guildId
   */
  makeAudienceGroup(guildId: string): AudienceGroupId {
    return makeStationAudienceGroup(AudienceType.Discord, this.id, guildId);
  }

  /**
   * Returns guild id which has audiences for this station
   */
  #getAudienceGuildsForStation(station: Station): string[] {
    return station.audienceGroups
      .map(group => {
        if ((station.getAudiences(group)?.size ?? 0) < 1) {
          return;
        }

        const { type, groupId } = extractAudienceGroupFromId(group);

        if (type !== AudienceType.Discord) {
          return;
        }

        const [automatonId, guildId] = groupId.split('/', 2);

        return (automatonId === this.id) ? guildId : undefined;
      })
      .filter((guildId): guildId is string => !!guildId);
  }

  canSendMessageTo(channel: TextChannel): boolean {
    const guild = channel.guild;
    const me = guild.members.me;

    if (!me) {
      return false;
    }

    return channel.members.has(me.id) && channel.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages);
  }

  #getTextChannel(guildId: string) {
    const state = this.#guildStates.get(guildId);

    if (!state) {
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);

    if (!guild) {
      return;
    }

    const textChannel = state.textChannelId ? guild.channels.cache.get(state.textChannelId) : undefined;

    if (textChannel?.type === ChannelType.GuildText) {
      if (this.canSendMessageTo(textChannel)) {
        return textChannel;
      }
    }

    // fallback
    if (guild.systemChannel && this.canSendMessageTo(guild.systemChannel)) {
      return guild.systemChannel;
    }
  }

  /**
   * Send to all guilds for a station
   */
  async #sendTrackPlayForStation(trackPlay: StationTrackPlay, deck: DeckIndex, station: Station) {
    const results: [guildId: string, trackMsg: TrackMessage, maybeMessage: Promise<Message<boolean> | undefined> | undefined][] = [];

    const guildIds = new Set([
      ...this.#getAudienceGuildsForStation(station),
      // Allow sending trackPlay to the guild that is interested in receiving it even if there aren't any audiences
      ...[...this.#guildStates.values()]
        .filter(state => (state.tunedStation === station) && this.#guildConfigs[state.guildId]?.trackMessage?.always)
        .map((state => state.guildId))
    ]);

    for (const guildId of guildIds) {
      const state = this.#guildStates.get(guildId);

      if (state?.tunedStation !== station) {
        continue;
      }

      const guild = this.client.guilds.cache.get(guildId);

      if (!guild) {
        continue;
      }

      const textChannel = this.#getTextChannel(guildId);

      if (!textChannel) {
        state.textChannelId = undefined;
        continue;
      }

      const positions = station.getDeckPositions(deck);
      const trackMsg = await state.trackMessageCreator.create({
        guildId,
        station,
        trackPlay,
        positions
      });

      const options = trackMessageToMessageOptions({
        ...trackMsg,
        buttons: {
          lyric: trackMsg.buttons.lyric,
          more: undefined,
          skip: undefined,
        }
      });

      const d = textChannel?.send(options).catch(e => void this.#logger.error(e));

      results.push([guildId, trackMsg, d]);
    }

    return results;
  }

  static async registerGuildCommands(options: Omit<RegisterOptions, 'guild'> & { guilds: OAuth2Guild[] }) {
    const { guilds } = options;

    return Promise.all(guilds.map(async guild => {
      await MedleyAutomaton.registerCommands({
        ...options,
        guild
      });
      await waitFor(3000);
    }));
  }

  static async registerCommands(options: RegisterOptions) {
    const { logger, guild, clientId, botToken, baseCommand } = options;
    try {
      if (guild) {
        logger.info(`Registering commands with guild id: ${guild.id} (${guild.name})`);
      } else {
        logger.info('Registering commands');
      }

      const rest = new REST();

      rest.setToken(botToken);

      await rest.put(
        (guild
          ? Routes.applicationGuildCommands(clientId, guild.id)
          : Routes.applicationCommands(clientId)
        ),
        {
          body: [createCommandDeclarations(baseCommand)]
        }
      )

      logger.info({ id: guild?.id, name: guild?.name }, 'Registered');
    }
    catch (e) {
      logger.error(e, 'Error registering command');
    }
  }

  get oAuth2Url() {
    const scopes = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands];

    const permissions = new PermissionsBitField(
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.ManageMessages |
      PermissionFlagsBits.AttachFiles |
      PermissionFlagsBits.AddReactions |
      PermissionFlagsBits.Connect |
      PermissionFlagsBits.Speak
    );

    const url = new URL('/api/oauth2/authorize', 'https://discord.com')
    url.searchParams.append('client_id', this.clientId);
    url.searchParams.append('scope', scopes.join(' '));
    url.searchParams.append('permissions', permissions.bitfield.toString());

    return url;
  }
}

