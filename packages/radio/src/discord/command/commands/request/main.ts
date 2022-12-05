import {
  AudienceType,
  BoomBoxTrack,
  createLogger,
  getTrackBanner,
  makeAudience,
  MusicLibraryExtra,
  Station
} from "@seamless-medley/core";

import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  SelectMenuBuilder,
  ChatInputCommandInteraction,
  ButtonStyle,
  SelectMenuComponentOptionData,
  MessageActionRowComponentBuilder,
  InteractionReplyOptions,
  SelectMenuInteraction
} from "discord.js";

import { chain, isNull, noop, take, truncate, zip } from "lodash";
import { parse as parsePath, extname } from 'path';
import { toEmoji } from "../../../emojis";
import { InteractionHandlerFactory } from "../../type";
import { guildStationGuard, HighlightTextType, makeHighlightedMessage, makeRequestPreview, reply } from "../../utils";

export type Selection = {
  title: string;
  artist?: string;
  track: BoomBoxTrack;
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
  }, 100);

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
      const title = truncate(track.extra?.tags?.title || parsePath(track.path).name, { length: 100 });
      const artist = track.extra?.tags?.artist ? truncate(track.extra.tags.artist || 'Unknown Artist', { length: 100 }) : undefined;

      return {
        title,
        artist,
        track
      }
    })
    .groupBy(({ title, artist = '' }) => `${title}:${artist}`.toLowerCase())
    .value();


  const [isGrouped, resultSelections] = ((): [grouped: boolean, data: SelectMenuComponentOptionData[]] => {
    const entries = Object.entries(groupedSelections);

    if (entries.length === 1) {
      return [false, makeTrackSelections(entries[0][1])];
    }

    return [true, take(entries, 25).map(([key, grouped]) => {
      const sel = grouped[0];
      const f = grouped.length > 1 ? ` // ${toEmoji(grouped.length.toString())} found` : '';
      return {
        label: `${sel.title}${f}`,
        description: sel.artist,
        value: key
      }
    })];
  })();

  const cancelButtonBuilder = new ButtonBuilder()
    .setCustomId('request:cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('❌');

  const searchResultMenu: InteractionReplyOptions = {
    content: 'Search result:',
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new SelectMenuBuilder()
            .setCustomId(isGrouped ? 'request' : 'request:pick')
            .setPlaceholder('Select a result')
            .addOptions(resultSelections)
        ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(cancelButtonBuilder),
    ]
  }

  const selector = await reply(interaction, { ...searchResultMenu, fetchReply: true });

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

    const makeRequest = async (interaction: SelectMenuInteraction, trackId: string) => {
      const ok = await station.request(trackId, makeAudience(AudienceType.Discord, guildId, interaction.user.id));

      if (ok === false || ok.index < 0) {
        interaction.update({
          content: makeHighlightedMessage('Track could not be requested for some reasons', HighlightTextType.Red),
          components: []
        });
        return;
      }

      const preview = await makeRequestPreview(station, ok.index, ok.index);

      await interaction.update({
        content: `Request accepted: \`${getTrackBanner(ok.track)}\``,
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
          content: `Sorry, this selection is for <@${issuer}> only`,
          ephemeral: true
        });
        return;
      }

      if (customId === 'request:cancel') {
        await stop();
        return;
      }

      collector.resetTimer({ time: 90_000 });

      const isSelectMenu = collected.isSelectMenu();

      if (customId === 'request:back') {
        collected.update({
          content: searchResultMenu.content,
          components: searchResultMenu.components
        });

        return;
      }

      if (customId === 'request' && isSelectMenu) {
        const [key] = collected.values;
        const choices = groupedSelections[key];

        if (!choices?.length) {
          collected.update({
            content: makeHighlightedMessage('Invalid request selection', HighlightTextType.Red),
            components: []
          });

          return;
        }

        if (choices.length === 1) {
          makeRequest(collected, choices[0].track.id);
          return;
        }

        const trackSelections = makeTrackSelections(choices);

        collected.update({
          content: 'Select a track',
          components: [
            new ActionRowBuilder<MessageActionRowComponentBuilder>()
              .addComponents(
                new SelectMenuBuilder()
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
        content: makeHighlightedMessage('Invalid request interaction', HighlightTextType.Red),
        ephemeral: true
      });
    });

    collector.on('end', async () => {
      if (!done && selector.editable) {
        await selector.edit({
          content: makeHighlightedMessage('Timed out, please try again', HighlightTextType.Yellow),
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
    .groupBy(c => {
      // Sorting order
      const { options } = c.track.collection;
      if (options.auxiliary) return 2;
      if (options.noFollowOnRequest) return 1;
      return 0;
    })
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
  .map(({ selection: { title, artist, track }, by }) => {
    const collectionName = (track.collection.extra as unknown as MusicLibraryExtra<Station>)?.descriptor.description ?? track.collection.id;

    return {
      label: `${title} - ${artist ?? 'Unknown Artist'}`,
      description: [collectionName, ...by].filter(Boolean).join('/'),
      value: track.id
    }
  })
  .value()
}
