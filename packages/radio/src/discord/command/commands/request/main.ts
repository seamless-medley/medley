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
  StringSelectMenuInteraction
} from "discord.js";

import { chain, chunk, clamp, Dictionary, isNull, noop, sortBy, truncate, zip } from "lodash";
import { parse as parsePath, extname } from 'path';
import { createHash } from 'crypto';
import { toEmoji } from "../../../emojis";
import { InteractionHandlerFactory } from "../../type";
import { formatMention, guildStationGuard, makeColoredMessage, makeRequestPreview, maxSelectMenuOptions, reply } from "../../utils";

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
    const preview = await makeRequestPreview(station);

    if (preview) {
      reply(interaction, preview.join('\n'))
    } else {
      reply(interaction, 'Request list is empty');
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
    const escq = (s: string) => s.replace(/"/g, '\\"');

    const tagTerms = zip(['artist', 'title'], [artist, title])
      .filter((t): t is [any, string] => !!t[1])
      .map(([n, v]) => `('${n}' ~ "${escq(v)}")`)
      .join(' AND ');

    const queryString = [tagTerms, query ? `(any ~ "${escq(query)}")` : null]
      .filter(t => !!t)
      .join(' OR ');

    reply(interaction, [
      'Your search:',
      '**```scheme',
      queryString,
      '```**',
      'Did not match any tracks'
    ].join('\n'))
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
      selection = sortBy(selection, selectionSortingOrder);

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

  const buildSearchResultMenu = (page: number): InteractionReplyOptions => {
    const components: MessageActionRowComponentBuilder[] = [cancelButtonBuilder];

    if (page > 0) {
      components.push(prevPageButtonBuilder.setLabel(`⏮ Page ${page}`));
    }

    if (page < totalPages - 1) {
      components.push(nextPageButtonBuilder.setLabel(`Page ${page + 2} ⏭`));
    }

    return {
      content: isGrouped ? `Search result, page ${page + 1}/${totalPages}:` : 'Select a track',
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
    const collector = selector.createMessageComponentCollector({ time: 90_000 });
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
      const ok = await station.request(trackId, makeAudience(AudienceType.Discord, guildId, interaction.user.id));

      if (ok === false || ok.index < 0) {
        interaction.update({
          content: makeColoredMessage('red', 'Track could not be requested for some reasons'),
          components: []
        });
        return;
      }

      const preview = await makeRequestPreview(station, ok.index, ok.index);

      await interaction.update({
        content: `Request accepted: **\`${getTrackBanner(ok.track)}\`**`,
        components: []
      });

      if (preview) {
        interaction.followUp({
          content: preview.join('\n')
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

      collector.resetTimer({ time: 90_000 });

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
          content: 'Select a track',
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

function makeTrackSelections(choices: Selection[]) {
  return chain(choices)
    .groupBy(selectionSortingOrder)
    .flatMap((auxGroup) => chain(auxGroup)
      .groupBy(c => c.track.collection.id) // Collection
      .flatMap((byCollection) => (byCollection.length === 1)
        ? { by: [], selection: byCollection[0] }
        : chain(byCollection)
        .groupBy(c => extname(c.track.path.toUpperCase()).substring(1)) // Extension
        .flatMap((byExt, ext) => (byExt.length === 1)
            ? { by: [ext], selection: byExt[0] }
            : chain(byExt)
              .groupBy(c => c.track.extra?.tags?.album ?? '') // Album
              .flatMap((byAlbum, album) => byAlbum.map(selection => ({ by: [ext, album], selection })))
              .value()
       )
       .value()
    )
    .value()
  )
  .take(maxSelectMenuOptions)
  .map(({ selection: { title, artist = 'Unknown Artist', track }, by }) => {
    const collectionName = track.collection.extra.description ?? track.collection.id;

    if (title.length + artist.length + 3 > 100) {
      title = truncate(title, { length: 100 - artist.length - 3 })
    }

    return {
      label: `${title} - ${artist}`,
      description: [collectionName, ...by].filter(Boolean).join('/'),
      value: track.id
    }
  })
  .value()
}

function selectionSortingOrder(selection: Selection): 0 | 1 | 2 {
  const { options } = selection.track.collection;
  if (options.auxiliary) return 2;
  if (options.noFollowOnRequest) return 1;
  return 0;
}
