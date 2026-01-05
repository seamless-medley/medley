import {
  ActionRowBuilder,
  ButtonBuilder,
  ChatInputCommandInteraction,
  ButtonStyle,
  SelectMenuComponentOptionData,
  MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField,
  bold,
  inlineCode,
  MessageComponentInteraction,
  ButtonInteraction,
  userMention,
  RepliableInteraction,
  quote
} from "discord.js";

import { chain, chunk, clamp, Dictionary, identity, isUndefined, truncate, uniqBy, zip } from "lodash";
import { parse as parsePath, extname } from 'node:path';
import { createHash } from 'crypto';

import { groupByAsync } from "@seamless-medley/utils";
import type { AudioProperties } from "@seamless-medley/medley";

import { toEmoji } from "../../../helpers/emojis";
import { AutomatonCommandError, InteractionHandlerFactory } from "../../type";
import { declare, deferReply, guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, makeRequestPreview, maxSelectMenuOptions, peekRequestsForGuild, reply } from "../../utils";
import { ansi } from "../../../format/ansi";
import { createVoteButton, getVoteMessage } from "../vote";
import { interact } from "../../interactor";
import { MedleyAutomaton } from "../../../automaton";
import { GuildState } from "../../../automaton/guild-state";

import {
  AudienceType,
  fetchAudioProps,
  getStationTrackSorters,
  getTrackBanner,
  LibrarySearchParams,
  makeRequester,
  Station,
  StationTrack,
  stringSimilarity
} from "../../../../core";

type Selection = {
  title: string;
  artist?: string;
  track: StationTrack;
  emoji?: string;
  priority?: number;
};

type SelectionsWithChunk = Selection[] & { fromChunk?: boolean };

const onGoing = new Set<string>();

type State = {
  menu: 'results' | 'pick';
  totalPages: number;
  page: number;
  choices: SelectionsWithChunk;
}

type MakeRequestOptions = {
  station: Station;
  automaton: MedleyAutomaton;
  guildId: string;
  trackId: string;
  noSweep: boolean;
  interaction: MessageComponentInteraction;
  done: () => Promise<void>
}

const makeRequest = async (options: MakeRequestOptions) => {
  const { station, automaton, guildId, noSweep, interaction, done } = options;

  const result = await station.request(
    options.trackId,
    makeRequester(
      AudienceType.Discord,
      { automatonId: automaton.id, guildId },
      interaction.user.id
    ),
    noSweep
  );

  if (typeof result === 'string' || result.index < 0) {
    await done();

    const reason = typeof result === 'string'
      ? result
      : 'invalid';

    interaction.update({
      content: makeColoredMessage(
        'red',
        `The track could not be requested: ${reason}`
      ),
      components: []
    });

    return;
  }

  const preview = await makeRequestPreview(station, {
    centerIndex: result.index,
    focusIndexes: [result.index],
    guildId
  });

  // When this is the only request track in the list and there are some tracks that are being cued/loaded before it.
  // The requester must be informed that the track he/she has just requested will not be played right after the currently playing track
  let notice: string | undefined;
  const requests = station.allRequests.all();

  if (requests.length === 1 && requests[0]!.rid === result.track.rid) {
    const cuedTrackCount = station.getTracksFromQueue().length || station.getTracksFromDecks().length;

    if (cuedTrackCount) {
      notice = `💡‼️ This request is deferred, some other tracks are about to be played`;
    }
  }

  await interaction.update({
    content: joinStrings([
      `${userMention(interaction.user.id)} Request accepted: ${bold(inlineCode(getTrackBanner(result.track)))}`,
      notice ? quote(notice) : undefined
    ]),
    components: []
  });

  if (preview) {
    const peekings = peekRequestsForGuild(station, 0, 20, guildId);
    const canVote = interaction.appPermissions?.any([PermissionsBitField.Flags.AddReactions]);

    interaction.followUp({
      content: joinStrings(preview),
      components: canVote && (peekings.length > 1) && (getVoteMessage(guildId) === undefined)
        ? [
          new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(createVoteButton())
        ]
        : undefined
    });
  }

  await done();
}

export const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const [artist, title, query] = ['artist', 'title', 'query'].map(f => interaction.options.getString(f) ?? undefined);

  const noSweep = interaction.options.getBoolean('no-sweep') ?? undefined;

  return handleRequestCommand({
    automaton,
    interaction,
    type: 'query',
    artist,
    title,
    query,
    noSweep
  });
}

type BaseRequestCommandOptions = {
  automaton: MedleyAutomaton;
  interaction: RepliableInteraction;
  noSweep?: boolean;
}

export type RequestCommandQueryOptions = BaseRequestCommandOptions & {
  type: 'query';
  artist?: string;
  title?: string;
  query?: string;
  fuzzy?: LibrarySearchParams['fuzzy'];

  spotifyArtistId?: string;
  duration?: number;

  noHistory?: boolean;
}

/**
 * @deprecated
 */
export type RequestCommandSpotifyTrackOptions = BaseRequestCommandOptions & {
  type: 'spotify:track';
  id: string;
  title: string;
}

export type RequestCommandSpotifyArtistOptions = BaseRequestCommandOptions & {
  type: 'spotify:artist';
  id: string;
  artist: string;
}

export type RequestCommandSpotifyOptions = RequestCommandSpotifyTrackOptions | RequestCommandSpotifyArtistOptions;

export type RequestCommandOptions = RequestCommandQueryOptions | RequestCommandSpotifyOptions;

export const handleRequestCommand = async (options: RequestCommandOptions) => {
  const {
    automaton,
    interaction,
    noSweep
  } = options;

  const { guildId, station } = guildStationGuard(automaton, interaction);

  if (options.type === 'query') {
    const { artist, title, query } = options;

    if ([artist, title, query].every(isUndefined)) {
      const preview = await makeRequestPreview(station, { guildId, count: 20 });

      if (!preview) {
        reply(interaction, station.requestsCount && interaction.guild?.name ? `Request list for ${interaction.guild.name} is empty` : 'Request list is empty');
        return;
      }

      const peekings = peekRequestsForGuild(station, 0, 20, guildId);
      const canVote = interaction.appPermissions?.any([PermissionsBitField.Flags.AddReactions]);

      reply(interaction, {
        content: joinStrings([`# Request list`, ...preview]),
        components: canVote && (peekings.length > 1) && (getVoteMessage(guildId) === undefined)
          ? [
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(createVoteButton())
          ]
          : undefined
      });

      return;
    }
  }

  await deferReply(interaction);

  const audioPropsPromises = new Map<StationTrack['id'], Promise<AudioProperties | undefined>>();

  const fetchTrackAudioProps = (track: StationTrack) => {
    if (audioPropsPromises.has(track.id)) {
      return audioPropsPromises.get(track.id)!;
    }

    const promise = (fetchAudioProps(track, station.metadataHelper) ?? Promise.resolve(undefined)).catch(() => undefined);
    audioPropsPromises.set(track.id, promise);

    return promise;
  }

  type Speciality = {
    priority?: number;
    emoji?: string;
  }

  type StationTrackForSelection = StationTrack & Speciality;

  const results: StationTrackForSelection[] = await (async () => {
    switch (options.type) {
      case 'query': {
        const { title, artist, query, spotifyArtistId, duration, fuzzy, noHistory } = options;

        const searchResults: StationTrackForSelection[] = await station.search({
          q: {
            artist,
            title,
            query
          },
          // 10 pages
          limit: maxSelectMenuOptions * 10,
          fuzzy,
          noHistory
        })
        .then(result => result.map(r => {
          const trackTitle = r.track.extra?.tags?.title;
          const artistName = r.track.extra?.tags?.artist;

          const scores = {
            title: trackTitle && title ? stringSimilarity(trackTitle, title) : 0,
            artist: artistName && artist ? stringSimilarity(artistName, artist) : 0
          }

          const score = (scores.title * 1.9 + scores.artist) / 2;

          return {
            ...r.track,
            ...(score >= 0.95
              ? {
                priority: 6 + score,
                emoji: '📀'
              }
              : undefined
            )
          }
        }));

        const mostLikelyTracks: StationTrackForSelection[] = [];

        if (spotifyArtistId) {
          const artistTracks = await station.findTracksByComment('spotify:artist', spotifyArtistId, { valueDelimiter: ',' });

          let onlyExactTitle = false;

          const scoredTracks: Array<{ track: StationTrack, score: number }> = [];

          for (const track of artistTracks) {
            let score = 0;

            const trackTitle = track.extra?.tags?.title;

            if (trackTitle && title) {
              if (trackTitle.toLowerCase() === title.toLowerCase()) {
                scoredTracks.push({
                  track,
                  score: 1
                });

                onlyExactTitle = true;

                continue;
              }

              if (!onlyExactTitle) {
                score = stringSimilarity(trackTitle, title);
              }
            }

            if (!onlyExactTitle && duration) {
              const trackDuration = await fetchTrackAudioProps(track).then(p => p?.duration);

              if (trackDuration) {
                const diff = Math.abs(duration - trackDuration);
                score = Math.max(score, (1 - (diff / trackDuration)));
              }
            }

            scoredTracks.push({
              track,
              score
            });
          };

          mostLikelyTracks.push(...chain(scoredTracks)
            .sortBy([t => -t.score, t => t.track.extra?.tags?.title])
            .map<StationTrackForSelection>(t => ({
              ...t.track,
              ...(t.score >= 0.995
                ? {
                  priority: 10 + t.score,
                  emoji: '✨'
                }
                : {
                  priority: 5,
                  emoji: '💿'
                }
              )
            }))
            .value()
          );
        }

        const foundTracks: StationTrackForSelection[] = [...searchResults, ...mostLikelyTracks];

        // re-apply priority/emoji to all tracks by its id
        const specialities = chain(foundTracks)
          .groupBy(t => t.id)
          .reduce((o, tracks) => {

            const likely = chain(tracks)
              .filter(t => t.priority !== undefined)
              .maxBy(t => t.priority)
              .value();

            if (likely?.priority) {
              o[likely.id] = {
                emoji: likely.emoji,
                priority: likely.priority,
                ...o[likely.id]
              }
            }

            return o;
          }, {} as Record<string, Speciality>)
          .value();

        for (const track of foundTracks) {
          const speciality = specialities[track.id];
          if (speciality) {
            track.emoji = speciality.emoji;
            track.priority = speciality.priority;
          }
        }

        return uniqBy(foundTracks, t => t.id);
      }

      /**
       * @deprecated This is not so useful since a spotify track can be resovled to a track id at the spotify url detection stage
       * and should perform an advanced track search instead when a track could not be found
       */
      case 'spotify:track':
        return station.findTracksByComment(options.type, options.id, { valueDelimiter: ',' });

      case 'spotify:artist': {
        const exactMatches = await station.findTracksByComment(
          options.type,
          options.id,
          {
            sort: { title: 1 },
            valueDelimiter: ','
          }
        );

        const searchResult =  await station.search({
          q: { artist: options.artist },
          fuzzy: 'exact'
        });

        return uniqBy(
          [
            ...exactMatches.map<StationTrackForSelection>(t => ({
              ...t,
              emoji: '📀'
            })),
            ...searchResult.map<StationTrackForSelection>(t => ({
              // Less priority
              ...t.track,
              priority: -1,
            }))
          ],
          t => t.id
        );
      }
    }
  })();

  if (results.length < 1) {
    const highlight = (n: string, v: string)  => ansi`({{yellow}}${n} {{cyan}}~ {{pink}}{{bgDarkBlue|b}}${v}{{reset}})`

    const terms: (string | undefined)[][] = (() => {
      switch (options.type) {
        case 'query':
          return zip(['artist', 'title'], [options.artist, options.title]);

        case 'spotify:artist':
          return [['artist', options.artist]];

        case 'spotify:track':
          return [['title', options.title]];
      }
    })();

    const tagTerms = terms
      .filter((t): t is [name: string, value: string] => !!t[1])
      .map(([n, v]) => highlight(n, v))
      .join(ansi` AND `);

    const query = options.type === 'query' ? options.query : undefined;

    const queryTerms = [tagTerms, query ? highlight('any', query) : null];

    const queryString = queryTerms
      .filter(t => !!t)
      .join(' OR ');

    return declare(
      interaction,
      joinStrings([
        'Your search:',
        ...makeAnsiCodeBlock(queryString),
        'Did not match any tracks'
      ]),
      { mention: { type: 'user', subject: interaction.user.id } }
    )
  }

  const groupedSelections = chain(results)
    .sortBy([
      // Highest priority comes first
      track => -(track.priority ?? 0),
      ...getStationTrackSorters(station)
    ])
    .map<Selection>((track) => {
      const title = track.extra?.tags?.title || parsePath(track.path).name;
      const artist = track.extra?.tags?.artist ? track.extra.tags.artist : undefined;

      return {
        title,
        artist,
        track,
        emoji: track.emoji,
        priority: track.priority
      }
    })
    .groupBy(({ title, artist = '' }) => createHash('sha256').update(`${title}:${artist}`.toLowerCase()).digest('base64'))
    .transform((groups, selection, groupKey) => {
      if (selection.length <= maxSelectMenuOptions) {
        groups[groupKey] = selection;
        return;
      }

      const chunks = chunk(selection, maxSelectMenuOptions);
      for (const [page, chunk] of chunks.entries()) {
        const pagedGroupKey = `${groupKey}:${page}`;

        groups[pagedGroupKey] = chunk;
        groups[pagedGroupKey].fromChunk = true;
      }
    }, {} as Dictionary<SelectionsWithChunk>)
    .value();

  const clarificationCtx: TrackClarificationContext = {
    getSamplerate: track => fetchTrackAudioProps(track).then(p => p?.sampleRate ?? 0),
    getBitrate: track => fetchTrackAudioProps(track).then(p => p?.bitrate ?? 0)
  }

  const makeTrackSelections = (choices: Selection[]) =>  clarifySelection({
    selections: choices,
    processors: trackClarificationProcessors,
    context: clarificationCtx
  });

  const [isGrouped, resultSelectionChunks] = await (async (): Promise<[grouped: boolean, data: SelectMenuComponentOptionData[][]]> => {
    const entries = Object.entries(groupedSelections);

    if (entries.length === 1) {
      return [false, [await makeTrackSelections(entries[0][1])]];
    }

    return [true, chain(entries)
      .map(([key, grouped]) => {
        const sel = grouped[0];

        const truncateFirst = (first: string, last: string = '') => (first.length + last.length) > 100
          ? truncate(first, { length: 100 - last.length }) + last
          : first + last;

        const label = truncateFirst(
          sel.title,
          (grouped.length > 1) || (grouped.fromChunk) ? ` 💿 ${toEmoji(grouped.length.toString())} found` : ''
        );

        const originalArtist = sel.track.extra?.tags?.originalArtist;

        const description = truncateFirst(
          (sel.artist ?? 'Unknown Artist') + (originalArtist ? ` (Original by ${originalArtist})` : '')
        );

        return {
          label,
          description,
          emoji: grouped.find(({ emoji }) => emoji)?.emoji,
          value: key
        }
      })
      .chunk(maxSelectMenuOptions)
      .value()
    ];
  })();

  const state: State = {
    menu: 'results',
    totalPages: resultSelectionChunks.length,
    page: 0,
    choices: []
  }

  const cancelButtonBuilder = new ButtonBuilder()
    .setCustomId('request_cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('❌');

  const prevPageButtonBuilder = new ButtonBuilder()
    .setCustomId('request_prevPage')
    .setStyle(ButtonStyle.Secondary)

  const nextPageButtonBuilder = new ButtonBuilder()
    .setCustomId('request_nextPage')
    .setStyle(ButtonStyle.Secondary);

  const backButtonBuilder = new ButtonBuilder()
    .setCustomId('request_back')
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('↩');

  const trackPickerBuilder = new StringSelectMenuBuilder()
    .setCustomId('request_pick')
    .setPlaceholder('Select a track')

  await interact({
    commandName: 'request',
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,
    formatTimeout: time => `Request Timeout: ${time}`,

    async makeCaption() {
      switch (state.menu) {
        case 'results':
          if (isGrouped && state.totalPages > 1) {
            return [`Search result, page ${state.page + 1}/${state.totalPages}:`]
          }

        case 'pick':
          return ['Select a track']
      }
    },

    async makeComponents() {
      const rows: Array<ActionRowBuilder<MessageActionRowComponentBuilder>> = [];

      const { page, totalPages, choices } = state;

      switch (state.menu) {
        case 'results': {
          const components: MessageActionRowComponentBuilder[] = [cancelButtonBuilder];

          if (page > 0) {
            components.push(prevPageButtonBuilder.setLabel(`⏮ Page ${page}`));
          }

          if (page < totalPages - 1) {
            components.push(nextPageButtonBuilder.setLabel(`Page ${page + 2} ⏭`));
          }

          rows.push(
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(isGrouped ? 'request' : 'request_pick')
                  .setPlaceholder(isGrouped ? 'Select a result' : 'Select a track')
                  .addOptions(resultSelectionChunks[page])
              ),
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(components),
          )

          break;
        }

        case 'pick':
          rows.push(
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(trackPickerBuilder.setOptions(await makeTrackSelections(choices))),

            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(cancelButtonBuilder, backButtonBuilder)
          );
      }

      return rows;
    },

    async onCollect({ collected, buildMessage, resetTimer, done }) {
      const { customId } = collected;

      // Cancel button
      if (customId === 'request_cancel') {
        await done(false);

        collected.update({
          content: makeColoredMessage('yellow', 'Canceled'),
          components: []
        });

        return;
      }

      resetTimer();

      // Paginate
      const paginationNavigation: Partial<Record<string, number>> = {
        'request_back': 0,
        'request_prevPage': -1,
        'request_nextPage': 1
      };

      if (customId in paginationNavigation) {
        const increment = paginationNavigation[customId] ?? 0;

        state.menu = 'results';
        state.page = clamp(state.page + increment, 0, state.totalPages - 1);

        collected.update(await buildMessage());

        return;
      }

      if (collected.isStringSelectMenu()) {
        const doneMakingRequest = () => done(false);

        // A track was picked
        if (customId === 'request_pick') {
          makeRequest({
            station,
            automaton,
            trackId: collected.values[0],
            guildId,
            noSweep: noSweep ?? false,
            interaction: collected,
            done: doneMakingRequest
          });

          return;
        }

        if (customId === 'request') {
          const [key] = collected.values;
          const choices = groupedSelections[key];

          if (!choices?.length) {
            collected.update({
              content: makeColoredMessage('red', 'Invalid request selection'),
              components: []
            });

            return;
          }

          if (choices.length === 1 && !choices.fromChunk) {

            makeRequest({
              station,
              automaton,
              guildId,
              trackId: choices[0].track.id,
              noSweep: noSweep ?? false,
              interaction: collected,
              done: doneMakingRequest
            });
            return;
          }

          state.menu = 'pick';
          state.choices = choices;

          collected.update(await buildMessage());

          return;
        }
      }
    },

    hook({ cancel }) {
      const handleStationChange = () => {
        cancel('Canceled, the station has been changed');
      }

      automaton.on('stationTuned', handleStationChange);

      return () => {
        automaton.off('stationTuned', handleStationChange);
      }
    },
  });
}

const isExtensionLossless = (ext: string) => /(flac|wav)/i.test(ext);

type TrackClarificationContext = {
  getSamplerate: (track: StationTrack) => Promise<number>;
  getBitrate: (track: StationTrack) => Promise<number>;
}

const trackClarificationProcessors: ClarificationProcessor<TrackClarificationContext>[] = [
  // By collection
  {
    getKey: (async s => s.track.collection.id),
    prioritize: identity,
    clarify: async (_, s) => s.track.collection.extra.description
  },
  // Same collection?, try extension
  {
    getKey: async s => extname(s.track.path.toUpperCase()).substring(1),
    prioritize: key => isExtensionLossless(key) ? -1 : 0,
    clarify: identity,
  },
  // Still not clear?, may be audio sample rate
  {
    getKey: async ({ track }, ctx) => ctx?.getSamplerate(track).then(v => (v/1000).toFixed(1)) ?? '',
    prioritize: k => -k,
    clarify: async (key, s, ctx) => key ? `${key}KHz` : ''
  },
  // Bitrate
  {
    getKey: async ({ track }, ctx) => ctx?.getBitrate(track).then(v => v.toString()) ?? '',
    prioritize: k => -k,
    clarify: async key => key ? `${key}Kbps` : ''
  },
  // Album
  {
    getKey: async s => s.track.extra?.tags?.album ?? '',
    prioritize: identity,
    clarify: identity
  }
];

function selectionToComponentData(selection: Selection, [collection, ...clarified]: string[]): SelectMenuComponentOptionData {
  const { title, artist = 'Unknown Artist', track, emoji } = selection;

  const description = [collection, clarified.filter(Boolean).join('; ')].filter(Boolean).join(' - ');

  return {
    label: truncate(`${title} - ${artist}`, { length: 100 }),
    description,
    emoji,
    value: track.id
  };
}

type ClarificationProcessor<C> = {
  getKey: (s: Selection, context: C | undefined) => Promise<string>;
  prioritize: (key: string, context: C | undefined) => number;
  clarify?: (key: string, sample: Selection, context: C | undefined) => Promise<string>;
}

type ClarificationOptions<C> = {
  selections: Selection[];
  processors: ClarificationProcessor<C>[];
  clarified?: string[];
  context?: C;
}

async function clarifySelection<C>(options: ClarificationOptions<C>) {
  const { selections, processors, clarified = [], context } = options;

  if (processors.length < 1) {
    return selections.map(sel => selectionToComponentData(sel, clarified));
  }

  const [processor, ...nextProcessors] = processors;

  const result: SelectMenuComponentOptionData[] = [];

  const groups = await groupByAsync(selections, s => processor.getKey(s, context));
  const keys = Object.keys(groups).sort(k => processor.prioritize(k, context));

  for (const key of keys) {
    const group = groups[key];

    if (group.length < 1) {
      continue;
    }

    const nextClarifications = [...clarified, await processor.clarify?.(key, group[0], context) ?? ''];

    if (group.length > 1) {
      result.push(...await clarifySelection({
        selections: group,
        processors: nextProcessors,
        clarified: nextClarifications,
        context
      }));

      continue;
    }

    if (group.length === 1) {
      result.push(selectionToComponentData(group[0], nextClarifications))
    }
  }

  return result;
}

type RequestButtonActionType = 'track' | 'artist_search' | 'track_search';

export const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, action: RequestButtonActionType, ...args: string[]) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  switch (action) {
    // request for a single track using track id
    case 'track': {
      const [trackId] = args;

      if (!trackId) {
        throw new RequestError(automaton, guildId, 'No track id');
      }

      return makeRequest({
        automaton,
        interaction,
        station,
        guildId,
        noSweep: false,
        trackId,
        done: async () => {}
      })
    }

    // search for tracks by using spotify artist id
    case 'artist_search': {
      const [artistId] = args;

      if (!artistId) {
        throw new RequestError(automaton, guildId, 'No artist id');
      }

      const artist = interaction.message.embeds.flatMap(e => e.fields).find(f => f.name === 'artist')?.value;

      if (!artist) {
        throw new RequestError(automaton, guildId, 'Invalid binding values');
      }

      const result = await handleRequestCommand({
        automaton,
        interaction,
        type: 'spotify:artist',
        id: artistId,
        artist
      })
      .catch(cause => new RequestError(automaton, guildId, 'Error while performing artist search', { cause }));

      if (result instanceof Error) {
        throw result;
      }

      return result;
    }

    // search for tracks by using fields from embed
    case 'track_search': {
      const [trackId] = args;

      if (!trackId) {
        throw new RequestError(automaton, guildId, 'No track id');
      }

      const fields = interaction.message.embeds.flatMap(e => e.fields);

      const binding = chain(['artist', 'title', 'duration', 'artist_id'])
        .map(name => [name, fields.find(f => f.name === name)?.value])
        .filter((row): row is [string, string] => !!row[1])
        .fromPairs()
        .value();

      if (!binding.artist || !binding.title) {
        throw new RequestError(automaton, guildId, 'Invalid binding values');
      }

      const duration = (() => {
        if (binding.duration) {
          const [m, s] = binding.duration.split(':').map(Number);
          return m * 60 + s;
        }
      })();

      const result = await handleRequestCommand({
        automaton,
        interaction,
        type: 'query',
        artist: binding.artist,
        title: binding.title,
        spotifyArtistId: binding.artist_id,
        duration,
        noHistory: true
      })
      .catch(cause => new RequestError(automaton, guildId, `Error while performing track search`, { cause }));

      if (result instanceof Error) {
        throw result;
      }

      return result;
    }
  }
}

/**
 * @deprecated
 */
async function fetchOriginalMessage(interaction: MessageComponentInteraction) {
  if (!interaction.channel) {
    return;
  }

  return interaction.message.fetchReference()
    .then(ref => ref.fetch())
    .catch(() => undefined);
}

class RequestError extends AutomatonCommandError {
  readonly state?: GuildState;

  constructor(automaton: MedleyAutomaton, guildId: string, message: string, options?: ErrorOptions) {
    super(automaton, message, options);
    this.state = automaton.getGuildState(guildId);
  }
}
