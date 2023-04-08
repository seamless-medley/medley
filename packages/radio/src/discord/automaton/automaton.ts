import { OAuth2Scopes, PermissionFlagsBits } from "discord-api-types/v10";

import {
  REST, Routes,
  Client, Guild,
  GatewayIntentBits, Message,
  OAuth2Guild,
  Snowflake, ChannelType, PermissionsBitField, PartialMessage
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
  Logger,
  ILogObj,
  createLogger,
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
import { makeCreator } from "../trackmessage/creator";

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
   * @default 3
   */
  maxTrackMessages?: number;
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
  logger: Logger<ILogObj>
}

export type AutomatonEvents = {
  ready: () => void;
}

export class MedleyAutomaton extends TypedEmitter<AutomatonEvents> {
  readonly id: string;

  botToken: string;
  clientId: string;

  owners: Snowflake[] = [];

  maxTrackMessages: number = 3;

  #baseCommand: string;

  #client: Client;

  #guildStates: Map<Guild['id'], GuildState> = new Map();

  #logger: Logger<ILogObj>;

  #rejoining = false;

  #shardReady = false;

  #audioDispatcher: AudioDispatcher;

  constructor(readonly stations: IReadonlyLibrary<Station>, options: MedleyAutomatonOptions) {
    super();

    this.#logger = createLogger({ name: `automaton/${options.id}` });

    this.id = options.id;
    this.botToken = options.botToken;
    this.clientId = options.clientId;
    this.owners = options.owners || [];
    this.maxTrackMessages = options.maxTrackMessages ?? 3;
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
      this.#logger.warn('Automaton Warning', message);
    });

    this.#client.on('error', (error) => {
      this.#logger.error('Automaton Error', error);
    });

    this.#client.on('shardError', this.handleShardError);

    this.#client.on('shardReconnecting', (shardId) => {
      this.#logger.debug('Shard', shardId, 'reconnecting');
    })

    this.#client.on('shardResume', (shardId) => {
      this.#logger.debug('Shard', shardId, 'resume');

      if (!this.#shardReady) {
        this.rejoinVoiceChannels(30);
      }

      this.#shardReady = true;
    });

    this.#client.on('shardReady', (shardId) => {
      this.#shardReady = true;
      this.#logger.debug('Shard', shardId, 'ready');
      this.rejoinVoiceChannels(30);
    })

    this.#client.on('ready', this.handleClientReady);
    this.#client.on('guildCreate', this.handleGuildCreate);
    this.#client.on('guildDelete', this.handleGuildDelete);
    // this.#client.on('voiceStateUpdate', this.handleVoiceStateUpdate);
    this.#client.on('interactionCreate', createInteractionHandler(this));

    this.#client.on('messageDelete', this.handleMessageDeletion);
    this.#client.on('messageDeleteBulk', async messages => void messages.mapValues(this.handleMessageDeletion))

    for (const station of stations) {
      station.on('trackStarted', this.handleTrackStarted(station));
      station.on('trackActive', this.handleTrackActive);
      station.on('trackFinished', this.handleTrackFinished);
      station.on('collectionChange', this.handleCollectionChange(station));
    }
  }

  get client() {
    return this.#client;
  }

  get baseCommand() {
    return this.#baseCommand || 'medley';
  }

  private handleShardError = (error: Error, shardId: number) => {
    this.#logger.error('Shard', shardId, 'error', error.message);

    this.#shardReady = false;
    this.#rejoining = false;
    this.removeAllAudiences();
  }

  private removeAllAudiences(closeConnection?: boolean) {
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

  private async rejoinVoiceChannels(timeoutSeconds: number) {
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

      if (channel?.type !== ChannelType.GuildVoice) {
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

          const result = state.join(channel, joinTimeout);

          this.#rejoining = false;
          this.#logger.info('Rejoined', { guild: channel.guild.name, channel: channel.name });

          return result;
      }, { retries, wait: 1000 }).then(() => state.preferredStation?.updatePlayback());
    }
  }

  get isReady() {
    return this.client.isReady();
  }

  private loginAbortController: AbortController | undefined;

  async login() {
    this.loginAbortController?.abort();
    this.loginAbortController = new AbortController();

    try {
      const result = await retryable(async () => {
        this.#logger.info('Logging in');

        return this.client.login(this.botToken)
          .catch(e => {
            this.#logger.error('Error login', e);
            throw e;
          });
      }, { wait: 5000, signal: this.loginAbortController.signal });

      if (result !== undefined) {
        this.#logger.debug('Logging in done');
      }
    }
    catch (e) {
      this.#logger.error('Error logging in', e);
    }
  }

  #baseAdapter: Omit<GuildStateAdapter, 'getChannel'> = {
    getClient: () => this.client,
    getLogger: () => this.#logger,
    getStations: () => this.stations,
    getAudioDispatcher: () => this.#audioDispatcher
  }

  private makeAdapter(guildId: Guild['id']): GuildStateAdapter {
    return ({
      ...this.#baseAdapter,
      getChannel: (id) => this.client.guilds.cache.get(guildId)?.channels.cache.get(id)
    });
  }

  ensureGuildState(guildId: Guild['id']) {
    if (!this.#guildStates.has(guildId)) {
      this.#guildStates.set(guildId, new GuildState(this, guildId, this.makeAdapter(guildId)));
    }

    return this.#guildStates.get(guildId)!;
  }

  getGuildState(id: Guild['id']): GuildState | undefined {
    return this.#guildStates.get(id);
  }

  private handleClientReady = async (client: Client) => {
    const guilds = [...(await client.guilds.fetch()).values()];

    for (const { id } of guilds) {
      this.ensureGuildState(id);
    };

    this.#logger.info('Ready');
    this.emit('ready');
  }

  private handleGuildCreate = async (guild: Guild) => {
    // Invited to
    this.#logger.info(`Invited to ${guild.name}`);

    this.ensureGuildState(guild.id);

    MedleyAutomaton.registerCommands(({
      guild,
      botToken: this.botToken,
      clientId: this.clientId,
      baseCommand: this.baseCommand,
      logger: this.#logger
    }));

    guild?.systemChannel?.send(`Greetings :notes:, use \`/${this.baseCommand} join\` command to invite me to a voice channel`);
  }

  private handleGuildDelete = async (guild: Guild) => {
    // Removed from
    this.#logger.info(`Removed from ${guild.name}`);
    this.#guildStates.get(guild.id)?.dispose();
    this.#guildStates.delete(guild.id);
  }

  private handleTrackStarted = (station: Station): StationEvents['trackStarted'] => async (deck: DeckIndex, trackPlay, lastTrackPlay) => {
    if (trackPlay.track.extra?.kind !== TrackKind.Insertion) {
      const sentMessages = await this.sendTrackPlayForStation(trackPlay, deck, station);

      // Store message for each guild
      for (const [guildId, trackMsg, maybeMessage] of sentMessages) {
        const state = this.#guildStates.get(guildId);

        if (!state?.voiceChannelId) {
          continue;
        }

        state.trackMessages.push({
          ...trackMsg,
          maybeMessage
        });

        if (state.trackMessages.length > this.maxTrackMessages) {
          const oldMessages = state.trackMessages.splice(0, state.trackMessages.length - this.maxTrackMessages);

          for (const { maybeMessage, lyricMessage } of oldMessages) {
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

  private handleTrackActive: StationEvents['trackActive'] = async (deck, trackPlay) => {
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

  private handleTrackFinished: StationEvents['trackFinished'] = (deck, trackPlay) => {
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

  private handleCollectionChange = (station: Station): StationEvents['collectionChange'] => (oldCollection, newCollection) => {
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

  private handleMessageDeletion = (message: Message<boolean> | PartialMessage) => {
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
                this.#logger.error('Error updating track message in guild', sentMessage.guild?.name, error);
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

  skipCurrentSong(id: Guild['id']) {
    const station = this.getGuildState(id)?.tunedStation;

    if (!station) {
      return false;
    }

    if (station.paused || !station.playing) {
      return false;
    }

    const { trackPlay } = station;

    if (!trackPlay) {
      return false;
    }

    if (!station.skip()) {
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
  private getAudienceGuildsForStation(station: Station): string[] {
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

  #trackMessageCreator = makeCreator('extended');
  /**
   * Send to all guilds for a station
   */
  private async sendTrackPlayForStation(trackPlay: StationTrackPlay, deck: DeckIndex, station: Station) {
    const results: [guildId: string, trackMsg: TrackMessage, maybeMessage: Promise<Message<boolean> | undefined> | undefined][] = [];

    const guildIds = this.getAudienceGuildsForStation(station);

    for (const guildId of guildIds) {
      const state = this.#guildStates.get(guildId);

      if (state?.tunedStation === station) {
        const guild = this.client.guilds.cache.get(guildId);
        const { textChannelId } = state;

        if (guild && state.hasVoiceChannel()) {
          const channel = textChannelId ? guild.channels.cache.get(textChannelId) : undefined;
          const textChannel = channel?.type == ChannelType.GuildText ? channel : undefined;

          const positions = station.getDeckPositions(deck);
          const trackMsg = await this.#trackMessageCreator.create({
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

          const d = (textChannel || guild.systemChannel)?.send(options).catch(e => void this.#logger.error(e));

          results.push([guildId, trackMsg, d]);
        }
      }
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
        logger.info('Registering commands with guild id:', guild.id, `(${guild.name})`);
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

      logger.debug('Registered', guild?.id, guild?.name);
    }
    catch (e) {
      logger.error('Error registering command', e);
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

