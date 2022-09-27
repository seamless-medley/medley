import { BoomBoxTrack, createLogger, MusicLibraryExtra, Station } from "@seamless-medley/core";
import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  SelectMenuBuilder,
  ChatInputCommandInteraction,
  ComponentType,
  ButtonStyle,
  SelectMenuComponentOptionData,
  MessageActionRowComponentBuilder
} from "discord.js";
import _, { isNull, truncate, uniq, zip } from "lodash";
import { parse as parsePath, extname } from 'path';
import { InteractionHandlerFactory } from "../../type";
import { guildStationGuard, HighlightTextType, makeHighlightedMessage, makeRequestPreview, reply } from "../../utils";
import { handleSelectMenu } from "./selectmenu";

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
    reply(interaction, 'Finish the ealier `request` command, please');
    return;
  }

  const [artist, title, query] = options;

  const results = await station.search({
    artist,
    title,
    query
  }, 25);

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

  type Selection = SelectMenuComponentOptionData & {
    track: BoomBoxTrack;
    group: string;
    distillations: string[];
    collection: BoomBoxTrack['collection']
  };

  const selections = results.map<Selection>(track => {
    const label = truncate(track.extra?.tags?.title || parsePath(track.path).name, { length: 100 });
    const description = track.extra?.tags?.title ? truncate(track.extra?.tags?.artist || 'Unknown Artist', { length: 100 }) : undefined;

    return {
      label,
      description,
      group: description || '',
      value: track.id,
      track,
      distillations: [],
      collection: track.collection
    }
  });

  function distrill(cb: (sel: Selection) => string | undefined) {
    _(selections)
      .groupBy(({ label, description, distillations }) => `${label}:${description}:${uniq(distillations.join('-'))}`.toLowerCase())
      .pickBy(group => group.length > 1)
      .forEach(group => {
        for (const sel of group) {
          const distrlled = cb(sel);
          if (distrlled) {
            sel.distillations.push(distrlled);
          }
        }
      });
  }

  // By collection
  distrill(sel => (sel.collection.extra as unknown as MusicLibraryExtra<Station>)?.descriptor.description ?? sel.collection.id);

  // By file extension
  distrill(sel => extname(sel.track.path.toUpperCase()).substring(1));

  // By album
  distrill(sel => sel.track.extra?.tags?.album);

  for (const sel of selections) {
    const distrillations = uniq(sel.distillations.filter(Boolean));

    const distilled = distrillations.length ? ` (${distrillations.map(d => `#${d}`).join(', ')})` : '';
    sel.description = truncate(sel.description + distilled, { length: 100 });
  }

  const selector = await reply(interaction, {
    content: 'Search result:',
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new SelectMenuBuilder()
            .setCustomId('request')
            .setPlaceholder('Select a track')
            .addOptions(selections)
        ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('cancel_request')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        )
    ],
    fetchReply: true
  });

  if (selector instanceof Message) {
    onGoing.add(runningKey);

    let done = false;

    const collector = selector.createMessageComponentCollector({
      componentType: ComponentType.SelectMenu,
      time: 90_000
    });

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
      onGoing.delete(runningKey);

      await handleSelectMenu(automaton, i);
    });

    collector.on('end', () => {
      if (!done && selector.editable) {
        onGoing.delete(runningKey);

        selector.edit({
          content: makeHighlightedMessage('Timed out, please try again', HighlightTextType.Yellow),
          components: []
        });
      }
    });

    selector.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => {
        i.deferUpdate();
        return i.customId === 'cancel_request' && i.user.id === issuer;
      },
      idle: 90_000
    })
    .then(() => {
      if (!done) {
        done = true;
        collector.stop();

        onGoing.delete(runningKey);

        if (selector.deletable) {
          selector.delete();
        }
      }
    })
    .catch((e) => {
      onGoing.delete(runningKey);
      if (!done) {
        logger.error(e);
      }
    });
  }
}
