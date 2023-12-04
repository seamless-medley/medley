import {
  AudienceType,
  getTrackBanner,
  makeAudience,
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
  MessageComponentInteraction
} from "discord.js";

import { chain, chunk, clamp, Dictionary, groupBy, identity, isUndefined, sample, sortBy, truncate, zip } from "lodash";
import { parse as parsePath, extname } from 'path';
import { createHash } from 'crypto';
import { toEmoji } from "../../../emojis";
import { InteractionHandlerFactory } from "../../type";
import { guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, makeRequestPreview, maxSelectMenuOptions, peekRequestsForGuild, reply } from "../../utils";
import { ansi } from "../../../format/ansi";
import { getVoteMessage } from "../vote";
import { interact } from "../../interactor";

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

export const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const options = ['artist', 'title', 'query'].map(f => interaction.options.getString(f) ?? undefined);

  const noSweep = interaction.options.getBoolean('no-sweep') ?? undefined;

  if (options.every(isUndefined)) {
    const preview = await makeRequestPreview(station, { guildId, count: 20 });

    if (preview) {
      reply(interaction, joinStrings([`# Request list`, ...preview]));
    } else {
      reply(interaction, station.requestsCount && interaction.guild?.name ? `Request list for ${interaction.guild.name} is empty` : 'Request list is empty');
    }

    return;
  }

  await interaction.deferReply();

  const [artist, title, query] = options;

  const results = await station.search(
    {
      artist,
      title,
      query
    },
    // 10 pages
    maxSelectMenuOptions * 10
  );

  if (results.length < 1) {
    const highlight = (n: string, v: string)  => ansi`({{yellow}}${n} {{cyan}}~ {{pink}}{{bgDarkBlue|b}}${v}{{reset}})`

    const tagTerms = zip(['artist', 'title'], [artist, title])
      .filter((t): t is [name: string, value: string] => !!t[1])
      .map(([n, v]) => highlight(n, v))
      .join(ansi` AND `);

    const queryString = [tagTerms, query ? highlight('any', query) : null]
      .filter(t => !!t)
      .join(' OR ');

    reply(interaction, joinStrings([
      'Your search:',
      ...makeAnsiCodeBlock(queryString),
      'Did not match any tracks'
    ]))
    return;
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

  const [isGrouped, resultSelectionChunks] = ((): [grouped: boolean, data: SelectMenuComponentOptionData[][]] => {
    const entries = Object.entries(groupedSelections);

    if (entries.length === 1) {
      return [false, [makeTrackSelections(entries[0][1])]];
    }

    return [true, chain(entries)
      .map(([key, grouped]) => {
        const sel = grouped[0];
        const f = (grouped.length > 1) || (grouped.fromChunk) ? ` 💿 ${toEmoji(grouped.length.toString())} found` : '';

        const title = (sel.title.length + f.length > 100) ? truncate(sel.title, { length: 100 - f.length }) : sel.title;
        const artist = sel.artist !== undefined ? truncate(sel.artist, { length: 100 }) : 'Unknown Artist';
        const originalArtist = sel.track.extra?.tags?.originalArtist;

        return {
          label: `${title}${f}`,
          description: `${artist}${originalArtist ? ` (Original by ${originalArtist})` : ''}`,
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
    .setCustomId('request:back')
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('↩');

  const trackPickerBuilder = new StringSelectMenuBuilder()
    .setCustomId('request:pick')
    .setPlaceholder('Select a track')

  const makeRequest = async (trackId: string, interaction: MessageComponentInteraction, runningKey: string, done: () => Promise<void>) => {
    const ok = await station.request(
      trackId,
      makeAudience(
        AudienceType.Discord,
        { automatonId: automaton.id, guildId },
        interaction.user.id
      ),
      noSweep
    );

    if (ok === false || ok.index < 0) {
      onGoing.delete(runningKey);

      interaction.update({
        content: makeColoredMessage('red', 'Track could not be requested for some reasons'),
        components: []
      });

      return;
    }

    const preview = await makeRequestPreview(station, {
      bottomIndex: ok.index,
      focusIndex: ok.index,
      guildId
    });

    await interaction.update({
      content: `Request accepted: ${bold(inlineCode(getTrackBanner(ok.track)))}`,
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

  await interact({
    commandName: 'request',
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,
    formatTimeout: time => `Request Timeout: ${time}`,

    makeCaption() {
      switch (state.menu) {
        case 'results':
          if (isGrouped && state.totalPages > 1) {
            return [`Search result, page ${state.page + 1}/${state.totalPages}:`]
          }

        case 'pick':
          return ['Select a track']
      }
    },

    makeComponents() {
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
                .setCustomId(isGrouped ? 'request' : 'request:pick')
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
              .addComponents(trackPickerBuilder.addOptions(makeTrackSelections(choices))),

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
        'request:back': 0,
        'request_prevPage': -1,
        'request_nextPage': 1
      };

      if (customId in paginationNavigation) {
        const increment = paginationNavigation[customId] ?? 0;

        state.menu = 'results';
        state.page = clamp(state.page + increment, 0, state.totalPages - 1);

        collected.update(buildMessage());

        return;
      }

      if (collected.isStringSelectMenu()) {
        const doneMakingRequest = () => done(false);

        // A track was picked
        if (customId === 'request:pick') {
          makeRequest(
            collected.values[0],
            collected,
            runningKey,
            doneMakingRequest
          );

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
            makeRequest(
              choices[0].track.id,
              collected,
              runningKey,
              doneMakingRequest
            );
            return;
          }

          state.menu = 'pick';
          state.choices = choices;

          collected.update(buildMessage());

          return;
        }
      }
    }
  });
}

const isExtensionLossless = (ext: string) => /(flac|wav)/i.test(ext);

const trackSelectionProcessors: ClarificationProcessor[] = [
  {
    getKey: (s => s.track.collection.id),
    prioritize: identity,
    clarify: (_, s) => s.track.collection.extra.description
  },
  {
    getKey: s => extname(s.track.path.toUpperCase()).substring(1),
    prioritize: key => isExtensionLossless(key) ? -1 : 0,
    clarify: identity,
  },
  {
    getKey: ({ track }) => ((track.extra?.tags?.sampleRate ?? 0) / 1000).toFixed(1),
    prioritize: k => -k,
    clarify: (key, s) => s.track.extra?.tags?.sampleRate ? `${key}KHz` : ''
  },
  {
    getKey: sel => sel.track.extra?.tags?.bitrate ?? 0,
    prioritize: k => -k,
    clarify: key => `${key}Kbps`
  },
  {
    getKey: s => s.track.extra?.tags?.album ?? '',
    prioritize: identity,
    clarify: identity
  }
];

const makeTrackSelections = (choices: Selection[]) => chain(choices)
  .groupBy(selectionOrder)
  .values()
  .flatMap(g => clarifySelection(g, trackSelectionProcessors))
  .value()

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
    label: `${title} - ${artist}`,
    description,
    value: track.id
  };
}

type ClarificationProcessor = {
  getKey: (s: Selection) => any;
  prioritize: (key: string) => number;
  clarify?: (key: string, sample: Selection) => string;
}

function clarifySelection(selections: Selection[], processors: ClarificationProcessor[], clarified: string[] = []) {
  if (processors.length < 1) {
    return selections.map(sel => selectionToComponentData(sel, clarified));
  }

  const [processor, ...nextProcessors] = processors;

  const result: SelectMenuComponentOptionData[] = [];

  const groups = groupBy(selections, s => processor.getKey(s));
  const keys = Object.keys(groups).sort(processor.prioritize);

  for (const key of keys) {
    const group = groups[key];

    if (group.length < 1) {
      continue;
    }

    const nextClarifications = [...clarified, processor.clarify?.(key, group[0]) ?? ''];

    if (group.length > 1) {
      result.push(...clarifySelection(group, nextProcessors, nextClarifications));
      continue;
    }

    if (group.length === 1) {
      result.push(selectionToComponentData(group[0], nextClarifications))
    }
  }

  return result;
}
