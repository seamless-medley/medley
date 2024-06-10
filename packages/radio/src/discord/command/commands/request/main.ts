import {
  AudienceType,
  AudioProperties,
  BoomBoxTrack,
  getTrackBanner,
  makeAudience,
  MetadataHelper,
  Station,
  StationTrack
} from "@seamless-medley/core";

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
  RepliableInteraction
} from "discord.js";

import { chain, chunk, clamp, Dictionary, flatten, fromPairs, groupBy, identity, isUndefined, sample, sortBy, truncate, zip } from "lodash";
import { parse as parsePath, extname } from 'node:path';
import { createHash } from 'crypto';
import { toEmoji } from "../../../helpers/emojis";
import { AutomatonCommandError, InteractionHandlerFactory } from "../../type";
import { declare, deferReply, deny, guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, makeRequestPreview, maxSelectMenuOptions, peekRequestsForGuild, reply } from "../../utils";
import { ansi } from "../../../format/ansi";
import { getVoteMessage } from "../vote";
import { interact } from "../../interactor";
import { groupByAsync, waitFor } from "@seamless-medley/utils";
import { MedleyAutomaton } from "../../../automaton";
import { extractSpotifyUrl, fetchSpotifyInfo } from "../../../helpers/spotify";
import { GuildState } from "../../../automaton/guild-state";

type Selection = {
  title: string;
  artist?: string;
  track: StationTrack;
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

const makeRequest = async ({ station, automaton, trackId, guildId, noSweep, interaction, done }: MakeRequestOptions) => {
  const result = await station.request(
    trackId,
    makeAudience(
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
    bottomIndex: result.index,
    focusIndex: result.index,
    guildId
  });

  await interaction.update({
    content: `${userMention(interaction.user.id)} Request accepted: ${bold(inlineCode(getTrackBanner(result.track)))}`,
    components: []
  });

  const peekings = peekRequestsForGuild(station, 0, 20, guildId);

  const canVote = interaction.appPermissions?.any([PermissionsBitField.Flags.AddReactions]);

  if (preview) {
    interaction.followUp({
      content: joinStrings(preview),
      components: canVote && (peekings.length > 1) && (getVoteMessage(guildId) === undefined)
        ? [
          new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setLabel('Vote')
                .setEmoji(sample(['✋🏼', '🤚🏼', '🖐🏼', '🙋🏼‍♀️', '🙋🏼‍♂️'])!)
                .setStyle(ButtonStyle.Secondary)
                .setCustomId(`vote:-`)
            )
        ]
        : undefined
    })
  }

  await done();
}

export const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const [artist, title, query] = ['artist', 'title', 'query'].map(f => interaction.options.getString(f) ?? undefined);

  const noSweep = interaction.options.getBoolean('no-sweep') ?? undefined;

  return handleRequestCommand({
    automaton,
    interaction,
    artist,
    title,
    query,
    noSweep
  });
}

export type RequestCommandOptions = {
  automaton: MedleyAutomaton;
  interaction: RepliableInteraction;
  artist?: string;
  title?: string;
  query?: string;
  noSweep?: boolean;
  noHistory?: boolean;
}

export const handleRequestCommand = async (options: RequestCommandOptions) => {
  const {
    automaton,
    interaction,
    artist,
    title,
    query,
    noSweep,
    noHistory
  } = options;

  const { guildId, station } = guildStationGuard(automaton, interaction);

  if ([artist, title, query].every(isUndefined)) {
    const preview = await makeRequestPreview(station, { guildId, count: 20 });

    if (preview) {
      reply(interaction, joinStrings([`# Request list`, ...preview]));
    } else {
      reply(interaction, station.requestsCount && interaction.guild?.name ? `Request list for ${interaction.guild.name} is empty` : 'Request list is empty');
    }

    return;
  }

  await deferReply(interaction);

  const results = await station.search({
    q: {
      artist,
      title,
      query
    },
    // 10 pages
    limit: maxSelectMenuOptions * 10,
    noHistory
  });

  if (results.length < 1) {
    const highlight = (n: string, v: string)  => ansi`({{yellow}}${n} {{cyan}}~ {{pink}}{{bgDarkBlue|b}}${v}{{reset}})`

    const tagTerms = zip(['artist', 'title'], [artist, title])
      .filter((t): t is [name: string, value: string] => !!t[1])
      .map(([n, v]) => highlight(n, v))
      .join(ansi` AND `);

    const queryString = [tagTerms, query ? highlight('any', query) : null]
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
    .map<Selection>((track) => {
      const title = track.extra?.tags?.title || parsePath(track.path).name;
      const artist = track.extra?.tags?.artist ? track.extra.tags.artist : undefined;

      return {
        title,
        artist,
        track
      }
    })
    .groupBy(({ title, artist = '' }) => createHash('sha256').update(`${title}:${artist}`.toLowerCase()).digest('base64'))
    .transform((d, selection, groupKey) => {
      selection = sortBy(selection, selectionOrder);

      if (selection.length <= maxSelectMenuOptions) {
        d[groupKey] = selection;
        return;
      }

      const chunks = chunk(selection, maxSelectMenuOptions);
      for (const [page, chunk] of chunks.entries()) {
        const pagedGroupKey = `${groupKey}:${page}`;

        d[pagedGroupKey] = chunk;
        d[pagedGroupKey].fromChunk = true;
      }
    }, {} as Dictionary<SelectionsWithChunk>)
    .value();

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

    async onCollect({ runningKey, collected, buildMessage, resetTimer, done }) {
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

function fetchAudioProps(track: BoomBoxTrack): Promise<AudioProperties> | undefined {
  const { extra } = track;

  if (!extra) {
    return;
  }

  if (extra.maybeAudioProperties === undefined) {
    extra.maybeAudioProperties = MetadataHelper.audioProperties(track.path);
  }

  return extra.maybeAudioProperties;
}

const trackSelectionProcessors: ClarificationProcessor[] = [
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
    getKey: async ({ track }) => (((await fetchAudioProps(track))?.sampleRate ?? 0) / 1000).toFixed(1),
    prioritize: k => -k,
    clarify: async (key, s) => (await fetchAudioProps(s.track))?.sampleRate ? `${key}KHz` : ''
  },
  // Bitrate
  {
    getKey: async ({ track }) => ((await fetchAudioProps(track))?.bitrate ?? 0).toString(),
    prioritize: k => -k,
    clarify: async key => `${key}Kbps`
  },
  // Album
  {
    getKey: async s => s.track.extra?.tags?.album ?? '',
    prioritize: identity,
    clarify: identity
  }
];

const makeTrackSelections = async (choices: Selection[]): Promise<SelectMenuComponentOptionData[]> => {
  const groups = Object.values(groupBy(choices, selectionOrder));
  const clarifications = groups.map(g => clarifySelection(g, trackSelectionProcessors));
  return flatten(await Promise.all(clarifications));
}

function selectionOrder(selection: Selection): 0 | 1 | 2 {
  const { options } = selection.track.collection;
  if (options?.auxiliary) return 2;
  if (options?.noFollowOnRequest) return 1;
  return 0;
}

function selectionToComponentData(selection: Selection, [collection, ...clarified]: string[]): SelectMenuComponentOptionData {
  const { title, artist = 'Unknown Artist', track } = selection;

  const description = [collection, clarified.filter(Boolean).join('; ')].filter(Boolean).join(' - ');

  return {
    label: truncate(`${title} - ${artist}`, { length: 100 }),
    description,
    value: track.id
  };
}

type ClarificationProcessor = {
  getKey: (s: Selection) => Promise<string>;
  prioritize: (key: string) => number;
  clarify?: (key: string, sample: Selection) => Promise<string>;
}

async function clarifySelection(selections: Selection[], processors: ClarificationProcessor[], clarified: string[] = []) {
  if (processors.length < 1) {
    return selections.map(sel => selectionToComponentData(sel, clarified));
  }

  const [processor, ...nextProcessors] = processors;

  const result: SelectMenuComponentOptionData[] = [];

  const groups = await groupByAsync(selections, s => processor.getKey(s));
  const keys = Object.keys(groups).sort(processor.prioritize);

  for (const key of keys) {
    const group = groups[key];

    if (group.length < 1) {
      continue;
    }

    const nextClarifications = [...clarified, await processor.clarify?.(key, group[0]) ?? ''];

    if (group.length > 1) {
      result.push(...await clarifySelection(group, nextProcessors, nextClarifications));
      continue;
    }

    if (group.length === 1) {
      result.push(selectionToComponentData(group[0], nextClarifications))
    }
  }

  return result;
}

export const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, action, ...args: string[]) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  switch (action) {
    case 'track': {
      const [trackId] = args;

      if (!trackId) {
        deny(interaction, 'Invalid track id');
        return;
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

    case 'search': {
      const params = fromPairs(args.map(a => a.split('$', 2)));

      return handleRequestCommand({
        automaton,
        interaction,
        artist: params.artist,
        title: params.title,
        query: params.query
      });
    }

    case 'cross_search': {
      if (!interaction.channel) {
        return;
      }

      const originalMessage = await interaction.message.fetchReference()
        .then(ref => ref.fetch())
        .catch(() => undefined);

      if (!originalMessage) {
        return;
      }

      const [matched] = extractSpotifyUrl(originalMessage.content);
      if (!matched?.url || matched?.paths?.[0] !== 'track') {
        return
      }

      const info = await fetchSpotifyInfo(matched.url.href);

      if (!info || info.type !== 'track' || !info.artist || !info.title) {
        return;
      }

      return handleRequestCommand({
        automaton,
        interaction,
        artist: info.artist,
        title: info.title,
        noHistory: true
      })
      .catch(e => new CrossSearchError(automaton, guildId, e.message));
    }
  }
}

class CrossSearchError extends AutomatonCommandError {
  readonly state?: GuildState;

  constructor(automaton: MedleyAutomaton, guildId: string, message: string) {
    super(automaton, message);
    this.state = automaton.getGuildState(guildId);
  }
}
