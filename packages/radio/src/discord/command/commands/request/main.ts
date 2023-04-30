import {
  AudienceType,
  createLogger,
  getTrackBanner,
  makeAudience,
  StationTrack
} from "@seamless-medley/core";

import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ChatInputCommandInteraction,
  ButtonStyle,
  SelectMenuComponentOptionData,
  MessageActionRowComponentBuilder,
  InteractionReplyOptions,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  PermissionsBitField
} from "discord.js";

import { chain, chunk, clamp, Dictionary, groupBy, identity, isNull, noop, sample, sortBy, truncate, zip } from "lodash";
import { parse as parsePath, extname } from 'path';
import { createHash } from 'crypto';
import { toEmoji } from "../../../emojis";
import { InteractionHandlerFactory } from "../../type";
import { formatMention, guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, makeRequestPreview, maxSelectMenuOptions, peekRequestsForGuild, reply } from "../../utils";
import { ansi } from "../../../format/ansi";
import { getVoteMessage } from "../vote";

export type Selection = {
  title: string;
  artist?: string;
  track: StationTrack;
};

const onGoing = new Set<string>();

const logger = createLogger({ name: 'command/request' });

export const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const options = ['artist', 'title', 'query'].map(f => interaction.options.getString(f));

  if (options.every(isNull)) {
    const preview = await makeRequestPreview(station, { guildId });

    if (preview) {
      reply(interaction, joinStrings(preview));
    } else {
      reply(interaction, station.requestsCount && interaction.guild?.name ? `Request list for ${interaction.guild.name} is empty` : 'Request list is empty');
    }

    return;
  }

  await interaction.deferReply();

  const issuer = interaction.user.id;

  const runningKey = `${guildId}:${issuer}`;

  if (onGoing.has(runningKey)) {
    reply(interaction, 'Finish the previous `request` command, please');
    return;
  }

  const [artist, title, query] = options;

  const results = await station.search({
    artist,
    title,
    query
  }, maxSelectMenuOptions * 10); // 10 pages

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
    }, {} as Dictionary<(Selection[]) & { fromChunk?: boolean }>)
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

        return {
          label: `${title}${f}`,
          description: artist,
          value: key
        }
      })
      .chunk(maxSelectMenuOptions)
      .value()
    ];
  })();

  const totalPages = resultSelectionChunks.length;
  let currentPage = 0;

  const cancelButtonBuilder = new ButtonBuilder()
    .setCustomId('request:cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('❌');

  const prevPageButtonBuilder = new ButtonBuilder()
    .setCustomId('request:prevPage')
    .setStyle(ButtonStyle.Secondary)

    const nextPageButtonBuilder = new ButtonBuilder()
    .setCustomId('request:nextPage')
    .setStyle(ButtonStyle.Secondary)

  const ttl = 90_000;

  const getTimeout = () => `Request Timeout: <t:${Math.trunc((Date.now() + ttl) / 1000)}:R>`;

  const buildSearchResultMenu = (page: number): InteractionReplyOptions => {
    const components: MessageActionRowComponentBuilder[] = [cancelButtonBuilder];

    if (page > 0) {
      components.push(prevPageButtonBuilder.setLabel(`⏮ Page ${page}`));
    }

    if (page < totalPages - 1) {
      components.push(nextPageButtonBuilder.setLabel(`Page ${page + 2} ⏭`));
    }

    return {
      content: joinStrings([
        getTimeout(),
        (isGrouped && totalPages > 1) ? `Search result, page ${page + 1}/${totalPages}:` : `Select a track:`
      ]),
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(isGrouped ? 'request' : 'request:pick')
              .setPlaceholder(isGrouped ? 'Select a result' : 'Select a track')
              .addOptions(resultSelectionChunks[page])
          ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(components),
      ]
    }
  }

  const selector = await reply(interaction, { ...buildSearchResultMenu(currentPage), fetchReply: true });

  if (selector instanceof Message) {
    const collector = selector.createMessageComponentCollector({ dispose: true, time: ttl });
    let done = false;

    const stop = async (shouldDelete: boolean = true) => {
      done = true;

      if (onGoing.has(runningKey)) {
        onGoing.delete(runningKey);

        collector.stop();

        if (shouldDelete && selector.deletable) {
          await selector.delete();
        }
      }
    }

    const makeRequest = async (interaction: StringSelectMenuInteraction, trackId: string) => {
      const ok = await station.request(
        trackId,
        makeAudience(
          AudienceType.Discord,
          { automatonId: automaton.id, guildId },
          interaction.user.id
        )
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
        index: ok.index,
        focus: ok.index,
        guildId
      });

      await interaction.update({
        content: `Request accepted: **\`${getTrackBanner(ok.track)}\`**`,
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

      await stop(false);
    }

    onGoing.add(runningKey);

    collector.on('collect', async (collected) => {
      const { customId, user } = collected;

      if (user.id !== issuer) {
        collected.reply({
          content: `Sorry, this selection is for ${formatMention('user', issuer)} only`,
          ephemeral: true
        });
        return;
      }

      // Cancel button
      if (customId === 'request:cancel') {
        await stop(false);
        collected.update({
          content: makeColoredMessage('yellow', 'Canceled'),
          components: []
        })
        return;
      }

      collector.resetTimer({ time: ttl });

      const paginationNavigation: Record<string, number> = {
        'request:back': 0,
        'request:prevPage': -1,
        'request:nextPage': 1
      };

      if (customId in paginationNavigation) {
        const increment = paginationNavigation[customId];

        currentPage = clamp(currentPage + increment, 0, totalPages - 1);

        const menu = buildSearchResultMenu(currentPage);

        collected.update({
          content: menu.content,
          components: menu.components
        });

        return;
      }

      const isSelectMenu = collected.isStringSelectMenu();

      if (customId === 'request' && isSelectMenu) {
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
          makeRequest(collected, choices[0].track.id);
          return;
        }

        const trackSelections = makeTrackSelections(choices);

        collected.update({

          content: joinStrings([
            getTimeout(),
            'Select a track']
          ),
          components: [
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('request:pick')
                  .setPlaceholder('Select a track')
                  .addOptions(trackSelections)
              ),
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(
                cancelButtonBuilder,
                new ButtonBuilder()
                  .setCustomId('request:back')
                  .setLabel('Back')
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji('↩')
              )
          ]
        });

        return;
      }

      if (customId === 'request:pick' && isSelectMenu) {
        makeRequest(collected, collected.values[0]);
        return;
      }

      collected.reply({
        content: makeColoredMessage('red', 'Invalid request interaction'),
        ephemeral: true
      });
    });

    collector.on('end', async () => {
      if (!done && selector.editable) {
        await selector.edit({
          content: makeColoredMessage('yellow', 'Timed out, please try again'),
          components: []
        })
        .catch(noop);
      }

      await stop(false);
    });
  }
}

const isExtensionLossless = (ext: string) => /(flac|wav)/i.test(ext);

const makeTrackSelections = (choices: Selection[]) => clarifySelection(choices,
  [
    {
      getKey: selectionOrder,
      prioritize: identity,
      clarify: (_, sample) => sample.track.collection.extra.description
    },
    {
      getKey: s => extname(s.track.path.toUpperCase()).substring(1),
      prioritize: key => isExtensionLossless(key) ? -1 : 0
    },
    {
      getKey: ({ track }) => ((track.extra?.tags?.sampleRate ?? 0) / 1000).toFixed(1),
      prioritize: k => -k
    },
    {
      getKey: sel => sel.track.extra?.tags?.bitrate ?? 0,
      prioritize: k => -k
    },
    {
      getKey: s => s.track.extra?.tags?.album ?? '',
      prioritize: identity,
      clarify: key => key
    }
  ],
)

function selectionOrder(selection: Selection): 0 | 1 | 2 {
  const { options } = selection.track.collection;
  if (options.auxiliary) return 2;
  if (options.noFollowOnRequest) return 1;
  return 0;
}

function selectionToComponentData(selection: Selection, clarified: string[]): SelectMenuComponentOptionData {
  const { title, artist = 'Unknown Artist', track } = selection;
  const { bitrate = 0, sampleRate = 0 } = selection.track.extra?.tags ?? {};

  const c = clarified.filter(Boolean).join('/');
  const fmt = [
    extname(selection.track.path.toUpperCase()).substring(1),
    sampleRate ? `${(sampleRate / 1000).toFixed(1)}KHz` : undefined,
    bitrate ? `${bitrate}Kbps` : undefined
  ].filter(Boolean).join('; ');

  const description =  [c, fmt].filter(Boolean).join(' - ');

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
