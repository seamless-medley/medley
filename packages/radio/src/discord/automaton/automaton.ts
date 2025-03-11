import {
  REST, Routes, OAuth2Scopes,
  RESTGetAPIApplicationCommandsResult,
  RESTGetAPIApplicationGuildCommandsResult,
  APIApplicationCommand,
  APIApplicationCommandOption,
  ApplicationCommandOptionType,
  APIApplicationCommandSubcommandOption,
  Client, Guild,
  GatewayIntentBits, Message,
  Snowflake,
  PermissionsBitField,
  PermissionFlagsBits,
  PartialMessage,
  MessageReaction,
  PartialMessageReaction,
  Emoji,
  MessageType,
  ActivityType,
  BaseInteraction
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
import { isChannelSuitableForTrackMessage, trackMessageToMessageOptions } from "../trackmessage";
import { GuildState, GuildStateAdapter, JoinResult } from "./guild-state";
import { AudioDispatcher } from "../../audio/exciter";
import { CreatorNames } from "../trackmessage/creator";
import { Logger, createLogger } from "@seamless-medley/logging";
import { intersection, isEqual, noop, sumBy, throttle } from "lodash";
import { Command, CommandOption, OptionType, SubCommandLikeOption } from "../command/type";
import { canSendMessageTo } from "../command/utils";

export enum AutomatonAccess {
  None = 0,
  DJ = 1,
  Moderator = 2,
  Administrator = 3,
  Owner = 0xFF
}

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
  bitrate?: number;

  gain?: number;

  djRoles?: Snowflake[];
}

export type MedleyAutomatonOptions = {
  id: string;

  globalMode: boolean;

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

  #globalMode: boolean = false;

  #baseCommand: string;

  #client: Client;

  #guildConfigs: NonNullable<MedleyAutomatonOptions['guilds']>;

  #guildStates: Map<Guild['id'], GuildState> = new Map();

  #logger: Logger;

  #rejoining = false;

  #shardReady = false;

  #audioDispatcher: AudioDispatcher;

  #stationEventHandlers = new Map<Station, Partial<StationEvents>>;

  constructor(readonly stations: IReadonlyLibrary<Station>, options: MedleyAutomatonOptions) {
    super();

    this.#logger = createLogger({ name: 'automaton', id: options.id });

    this.id = options.id;
    this.#globalMode = options.globalMode;
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
        GatewayIntentBits.GuildVoiceStates,
        // This intent is not required, but must be enabled for the Spotify URL detection to work
        // GatewayIntentBits.MessageContent
      ]
    });

    this.#client.on('warn', message => {
      this.#logger.warn(`Automaton Warning ${message}`);
    });

    this.#client.on('error', (error) => {
      this.#logger.error(error, 'Automaton Error');
    });

    this.#client.on('ready', this.#handleClientReady);
    this.#client.on('guildCreate', this.#handleGuildCreate);
    this.#client.on('guildDelete', this.#handleGuildDelete);
    this.#client.on('interactionCreate', createInteractionHandler(this));

    this.#client.on('messageCreate', this.#handleMessageCreation);
    this.#client.on('messageDelete', this.#handleMessageDeletion);
    this.#client.on('messageDeleteBulk', async messages => void messages.mapValues(this.#handleMessageDeletion));

    this.#client.on('messageReactionAdd', message => this.#handleMessageReaction(message, 'add'));
    this.#client.on('messageReactionRemove', message => this.#handleMessageReaction(message, 'remove'));
    this.#client.on('messageReactionRemoveEmoji', message => this.#handleMessageReaction(message, 'remove'));
    this.#client.on('messageReactionRemoveAll', this.#handleMessageReactionRemoveAll);

    for (const station of stations) {
      const handlers: Partial<StationEvents> = {
        deckStarted: this.#handleDeckStarted(station),
        trackStarted: this.#handleTrackStarted(station),
        trackActive: this.#handleTrackActive(station),
        trackFinished: this.#handleTrackFinished(station),
        trackSkipped: this.#handleTrackSkipped(station),
        collectionChange: this.#handleCollectionChange(station),
        libraryStats: this.#updateLibraryStats
      }

      for (const [name, handler] of Object.entries(handlers)) {
        station.on(name as any, handler);
      }

      this.#stationEventHandlers.set(station, handlers);
    }

    this.#client.once('ready', async () => {
      this.#shardReady = true;

      this.#client.on('shardError', this.#handleShardError);

      this.#client.on('shardReconnecting', (shardId) => {
        this.#logger.debug(`Shard ${shardId}, reconnecting`);
      })

      this.#client.on('shardResume', (shardId) => {
        this.#logger.debug(`Shard ${shardId}, resume`);

        if (!this.#shardReady) {
          this.#rejoinVoiceChannels(30);
        }

        this.#updateLibraryStats();

        this.#shardReady = true;
      });

      this.#client.on('shardReady', (shardId) => {
        this.#shardReady = true;
        this.#logger.debug(`Shard ${shardId}, ready`);
        this.#rejoinVoiceChannels(30);
      });

      this.#updateLibraryStats();

      Object.keys(this.#guildConfigs).map(async (guildId) => {
        this.ensureGuildState(guildId);

        await this.#autoTuneStation(guildId);
        await this.#autoJoinVoiceChannel(guildId);
      });
    });
  }

  destroy() {
    for (const [station, handlers] of this.#stationEventHandlers) {
      for (const [name, handler] of Object.entries(handlers)) {
        station.off(name as any, handler);
      }
    }

    this.#client.destroy();
    this.#audioDispatcher.clear();
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

  #removeAllAudiences() {
    // Remove audiences from all stations
    for (const [guildId, state] of this.#guildStates) {
      const group = this.makeAudienceGroup(guildId);

      for (const station of this.stations) {
        station.removeAudiencesForGroup(group)
      }
    }
  }

  async #autoTuneStation(guildId: string) {
    const config = this.#guildConfigs[guildId];

    if (!config?.autotune) {
      return;
    }

    const state = this.ensureGuildState(guildId);

    const stationToTune = this.stations.get(config?.autotune);

    if (stationToTune) {
      await state.tune(stationToTune)
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

    // This promise resolves right after the first attempt
    return new Promise<void>(async (notifyLoginAttempted) => {
      // Keep retrying
      const result = await retryable(async () => {
        this.#logger.info('Login');

        // Resolve the `login` method as soon as a login attempt is finish
        const attemptResult = this.client.login(this.botToken).finally(notifyLoginAttempted);

        // Catch any error during a login attempt
        await attemptResult.catch((e) => {
          this.#logger.error('Login error: %s', e.message);
          // Let the `retryable` know about this error, so it can retry
          throw e;
        });

        return attemptResult;

      }, { wait: 5_000, maxWait: 60_000, factor: 1.09, signal: this.#loginAbortController?.signal });

      if (result !== undefined) {
        this.#logger.info('Login OK');

        await this.registerCommandsIfNeccessary();
        this.#logger.info('OAUthURL: %s', this.oAuth2Url.toString());
      }
    })
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

  getGuildConfig(id: Guild['id']): GuildSpecificConfig | undefined {
    this.#guildConfigs[id] ??= {};
    return this.#guildConfigs[id];
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

    if (!this.#globalMode) {
      this.#logger.info(`Registering commands with guild id: ${guild.id} (${guild.name})`);

      new REST().setToken(this.botToken).put(Routes.applicationGuildCommands(this.clientId, guild.id),
        {
          body: [createCommandDeclarations(this.#baseCommand)]
        }
      ).catch(noop);
    }

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

  #handleDeckStarted = (station: Station): StationEvents['deckStarted'] => (deck, trackPlay) => {
    if (!trackPlay.track.extra) {
      return;
    }

    const guildIds = this.#getAudienceGuildsForStation(station);

    if (trackPlay.track.extra.kind === TrackKind.Insertion) {
      for (const guildId of guildIds) {
        this.#guildStates.get(guildId)?.temporarilyDisableKaraoke();
      }

      return;
    }

    for (const guildId of guildIds) {
      this.#guildStates.get(guildId)?.restoreKaraoke();
    }
  }

  #handleTrackStarted = (station: Station): StationEvents['trackStarted'] => async (deck, trackPlay, lastTrackPlay) => {
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
      if (msg.station !== station) {
        return;
      }

      // Ignore track message that has just started
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

  #handleTrackActive = (station: Station): StationEvents['trackStarted'] => async (deck, trackPlay) => {
    await waitFor(1000);

    // Reveal all buttons for this trackPlay
    this.updateTrackMessage(async (msg) => {
      if (msg.station !== station) {
        return;
      }

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

  #handleTrackFinished = (station: Station): StationEvents['trackFinished'] => (deck, trackPlay) => {
    // Update this trackPlay status to "Played"
    this.updateTrackMessage(async (msg) => {
      if (msg.station !== station) {
        return;
      }

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

  #handleTrackSkipped = (station: Station): StationEvents['trackSkipped'] => (trackPlay) => {
    this.updateTrackMessage(async (msg) => {
      if (msg.station !== station) {
        return;
      }

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
    });
  }

  #handleCollectionChange = (station: Station): StationEvents['collectionChange'] => (oldCollection, newCollection) => {
    // Hide "more like this" button for this currently playing track
    this.updateTrackMessage(async (msg) =>  {
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
    })
  }

  #handleMessageCreation = async (message: Message<boolean> | PartialMessage) => {
    if (message.system || message.author?.bot || message.author?.system) {
      return;
    }

    if (message.type !== MessageType.Default) {
      return;
    }

    if (!message.inGuild() || !isChannelSuitableForTrackMessage(message.channel)) {
      return;
    }

    const state = this.#guildStates.get(message.guildId);
    if (!state) {
      return;
    }

    await message.fetch();
    state.handleIncomingMessage(message);
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
      return 'no_station';
    }

    if (station.paused || !station.playing) {
      this.#logger.warn({ guildId }, 'Deny skipping: not playing');
      return 'not_playing';
    }

    const { trackPlay } = station;

    if (!trackPlay) {
      this.#logger.warn({ guildId }, 'Deny skipping: no track play');
      return 'no_trackplay';
    }

    if (!station.skip()) {
      this.#logger.warn({ guildId }, 'Deny skipping: denied by engine');
      return 'denied';
    }

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

        const [automatonId, guildId] = groupId;

        return (automatonId === this.id) ? guildId : undefined;
      })
      .filter((guildId): guildId is string => !!guildId);
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

    const channelId = state.textChannelId || state.voiceChannelId;

    const textChannel = channelId
      ? guild.channels.cache.get(channelId)
      : undefined;

    if (textChannel && isChannelSuitableForTrackMessage(textChannel) && canSendMessageTo(textChannel)) {
      return textChannel;
    }

    // fallback
    if (guild.systemChannel && canSendMessageTo(guild.systemChannel)) {
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
        positions,
        async metadataLookup(kind, val) {
          if (kind === 'spotify:artist') {
            const tracksFromSoloArtist = await station.musicDb.findByComment(kind, val);
            return tracksFromSoloArtist.find(t => !!t.artist)?.artist;
          }
        }
      });

      const options = trackMessageToMessageOptions({
        ...trackMsg,
        buttons: {
          lyric: trackMsg.buttons.lyric,
          more: undefined,
          skip: undefined,
        }
      });

      const d = textChannel?.send(options).catch(e => {
        this.#logger.error(`Could not send track message to ${textChannel?.name} on ${guild.name}: ${e.message}`);
        return undefined;
      });

      results.push([guildId, trackMsg, d]);
    }

    return results;
  }

  async registerCommandsIfNeccessary() {
    const rest = new REST().setToken(this.botToken);

    const guilds = [...await this.client.guilds.fetch().then(col => col.values())];

    const guildsCommand = new Map<string, APIApplicationCommand>();

    for (const guild of guilds) {
      const guildCommand = await rest.get(Routes.applicationGuildCommands(this.clientId, guild.id))
        .then(list => (list as RESTGetAPIApplicationGuildCommandsResult).find(cmd => {
          return cmd.name === this.#baseCommand
        }))

      if (guildCommand) {
        guildsCommand.set(guild.id, guildCommand);
      }
    }

    const declaredCommand = createCommandDeclarations(this.#baseCommand);

    const isSubCommandOptionIdentical = (a: APIApplicationCommandSubcommandOption, b: SubCommandLikeOption): string | true => {
      if (!a.options && !b.options) {
        return true;
      }

      if (!a.options || !b.options) {
        return 'Options mismatch';
      }

      if (a.options.length !== b.options.length) {
        return 'Options size mismatch';
      }

      for (let i = 0; i < a.options.length; i++) {
        if ((a.options[i].type as any) !== (b.options[i].type as any)) {
          return 'Option type mismatch';
        }

        if (a.options[i].name !== b.options[i].name) {
          return 'Option name mismatch';
        }

        if (a.options[i].description !== b.options[i].description) {
          return 'Option description mismatch';
        }

        if ((a.options[i].required ?? false) !== (b.options[i].required ?? false)) {
          return 'Option required flag mismatch';
        }

        if (b.options[i].type === OptionType.Channel) {
          if (!isEqual((a.options[i] as any).channel_types, (b.options[i] as any).channel_types)) {
            return 'Channel types mismatch'
          }
        }
      }

      return true;
    }

    const isSubCommandIdentical = (a: APIApplicationCommandOption[], b: CommandOption[]): string | true => {
      if (a.length !== b.length) {
        return 'Subcommand mismatch';
      }

      for (let i = 0; i < a.length; i++) {
        if (a[i].type as any !== b[i].type as any) {
          return 'Subcommand type mismatch';
        }

        if (a[i].type === ApplicationCommandOptionType.Subcommand) {
          const optionIdentical = isSubCommandOptionIdentical(
            a[i] as APIApplicationCommandSubcommandOption,
            b[i] as SubCommandLikeOption
          );

          if (optionIdentical !== true) {
            return optionIdentical;
          }
        }

        if (a[i].name !== b[i].name) {
          return 'Subcommand name mismatch';
        }

        if (a[i].description !== b[i].description) {
          return 'Subcommand description mismatch';
        }
      }

      return true;
    }

    const isCmdIdentical = (a: APIApplicationCommand, b: Command): string | true => {
      if (a.type as any !== b.type as any) {
        return 'Type mismatch';
      }

      if (a.name !== b.name) {
        return 'Name mismatch';
      }

      if (a.description !== b.description) {
        return 'Description mismatch';
      }

      return isSubCommandIdentical(a.options ?? [], b.options ?? []);
    }

    if (this.#globalMode) {
      const globalCommand = await rest.get(Routes.applicationCommands(this.clientId))
        .then(list => (list as RESTGetAPIApplicationCommandsResult).find(cmd => cmd.name === this.#baseCommand))
        .then(command => command as APIApplicationCommand | undefined);

      const registrationCheck = !!globalCommand && isCmdIdentical(globalCommand, declaredCommand);

      if (registrationCheck !== true) {
        this.#logger.info(`Registering global command, ${registrationCheck || 'not yet registered'}`);

        await rest.put(Routes.applicationCommands(this.clientId),
          {
            body: [declaredCommand]
          }
        )
        .catch((e) => {
          this.#logger.error({ message: e.message }, 'Error registerting global command');
        })
      }

      for (const guild of guilds) {
        const existing = guildsCommand.get(guild.id);

        if (existing) {
          this.#logger.info(`Deleting commands for guild id: ${guild.id} (${guild.name})`);

          await rest.delete(Routes.applicationGuildCommand(this.clientId, guild.id, existing.id),
            {
              body: [declaredCommand]
            }
          )

          await waitFor(2000);
        }
      }
    } else {
      for (const guild of guilds) {
        const existing = guildsCommand.get(guild.id);

        const registrationCheck = !!existing && isCmdIdentical(existing, declaredCommand);

        if (registrationCheck !== true) {
          this.#logger.info(`Registering commands with guild id (${registrationCheck || 'not yet registered'}): ${guild.id} (${guild.name})`);

          await rest.put(Routes.applicationGuildCommands(this.clientId, guild.id),
            {
              body: [declaredCommand]
            }
          )
          .catch((e) => {
            this.#logger.error({ message: e.message, guild: { name: guild.name, id: guild.id} }, 'Error registerting guild command');
          })

          await waitFor(2000);
        }
      }
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

  get totalListeners() {
    return sumBy(this.stations.all(), s => s.audienceCount);
  }

  get totalTracks() {
    return sumBy(this.stations.all(), station => station.libraryStats.indexed ?? 0);
  }

  #updateLibraryStats =  throttle(() => {
    if (!this.#client.user) {
      return;
    }

    const formatter = new Intl.NumberFormat();

    this.#client.user.setActivity({
      name: `Serving ${formatter.format(this.totalTracks)} tracks from ${formatter.format(this.stations.size)} stations`,
      type: ActivityType.Custom
    });
  }, 5000);

  getAccessForPermissions(permissions: PermissionsBitField) {
    if (permissions.has(PermissionFlagsBits.Administrator)) {
      return AutomatonAccess.Administrator;
    }

    const hasPriviledge = permissions.any([
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers
    ]);

    if (hasPriviledge) {
      return AutomatonAccess.Moderator;
    }
  }

  async getAccessFor(interaction: BaseInteraction): Promise<AutomatonAccess> {
    const userId = interaction.user.id;

    if (this.owners.includes(userId)) {
      return AutomatonAccess.Owner;
    }

    if (interaction.guild) {
      if (interaction.memberPermissions) {
        const memberAccess = this.getAccessForPermissions(interaction.memberPermissions);
        if (memberAccess !== undefined) {
          return memberAccess;
        }
      }

      const state = this.getGuildState(interaction.guild.id);

      if (state?.voiceChannelId) {
        const channel = await interaction.guild.channels?.fetch(state.voiceChannelId);

        if (channel?.isVoiceBased()) {
          const isModerator = channel.permissionsFor(userId)?.any(
            [PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers],
            true
          );

          if (isModerator) {
            return AutomatonAccess.Moderator;
          }
        }
      }

      if (await this.isGuildDJ(interaction.guild, userId)) {
        return AutomatonAccess.DJ;
      }
    }

    return AutomatonAccess.None;
  }

  async isGuildDJ(guild: Guild, userId: string) {
    const config = this.#guildConfigs[guild.id];

    if (config?.djRoles) {
      const member = await guild.members.fetch(userId);
      const memberRoleIds = member.roles.cache.map(role => role.id);

      if (intersection(memberRoleIds, config.djRoles).length) {
        return AutomatonAccess.DJ;
      }
    }
  }
}

