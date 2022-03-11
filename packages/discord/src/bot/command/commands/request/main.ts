import { BoomBoxTrack } from "@seamless-medley/core";
import { CommandInteraction, Message, MessageActionRow, MessageButton, MessageSelectMenu, MessageSelectOptionData } from "discord.js";
import _, { truncate } from "lodash";
import { parse as parsePath } from 'path';
import { Station } from "../../../station";
import { MusicLibraryMetadata } from "../../../station/music_collections";
import { InteractionHandlerFactory } from "../../type";
import { guildStationGuard, HighlightTextType, makeHighlightedMessage, makeRequestPreview, reply } from "../../utils";
import { handleSelectMenu } from "./selectmenu";

export const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { station } = guildStationGuard(automaton, interaction);

  const options = ['artist', 'title', 'query'].map(f => interaction.options.getString(f));

  if (options.every(_.isNull)) {
    const preview = await makeRequestPreview(station);

    if (preview) {
      interaction.reply(preview.join('\n'))
    } else {
      interaction.reply('Request list is empty');
    }

    return;
  }

  await interaction.deferReply();

  const [artist, title, query] = options;

  const results = station.search({
    artist,
    title,
    query
  }, 10);

  if (results.length < 1) {
    const escq = (s: string) => s.replace(/"/g, '\\"');

    const tagTerms = _.zip(['artist', 'title'], [artist, title])
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

  const issuer = interaction.user.id;

  const selections = results.map<MessageSelectOptionData & { collection: BoomBoxTrack['collection'] }>(track => ({
    label: truncate(track.metadata?.tags?.title || parsePath(track.path).name, { length: 100 }),
    description: track.metadata?.tags?.title ? truncate(track.metadata?.tags?.artist || 'Unknown Artist', { length: 100 }) : undefined,
    value: track.id,
    collection: track.collection
  }));

  // Distinguish duplicated track artist and title
  _(selections)
    .groupBy(({ label, description }) => `${label}:${description}`)
    .pickBy(group => group.length > 1)
    .forEach(group => {
      for (const sel of group) {
        const { description } = sel.collection.metadata as unknown as MusicLibraryMetadata<Station>;
        sel.description += ` (from \'${description ?? sel.collection.id}\' collection)`
      }
    });

  const selector = await reply(interaction, {
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
    let done = false;

    const collector = selector.createMessageComponentCollector({ componentType: 'SELECT_MENU', time: 30_000 });

    collector.on('collect', async i => {
      if (i.user.id !== issuer) {
        i.reply({
          content: `Sorry, this selection is for <@${issuer}> only`,
          ephemeral: true
        })
        return;
      }

      done = true;
      collector.stop();
      await handleSelectMenu(automaton, i);
    });

    collector.on('end', () => {
      if (!done && selector.editable) {
        selector.edit({
          content: makeHighlightedMessage('Timed out, please try again', HighlightTextType.Yellow),
          components: []
        });
      }
    });

    selector.awaitMessageComponent({
      componentType: 'BUTTON',
      filter: (i) => {
        i.deferUpdate();
        return i.customId === 'cancel_request' && i.user.id === issuer;
      },
      time: 60_000
    })
    .then(() => {
      done = true;
      collector.stop();

      if (selector.deletable) {
        selector.delete();
      }
    })
    .catch(() => void undefined);
  }
}