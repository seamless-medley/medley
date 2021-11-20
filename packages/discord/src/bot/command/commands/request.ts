import { BoomBoxTrack, RequestTrack, TrackPeek } from "@medley/core";
import {
  ApplicationCommandOptionChoice,
  AutocompleteInteraction,
  CommandInteraction,
  Message,
  MessageActionRow,
  MessageButton,
  MessageSelectMenu,
  MessageSelectOptionData,
  SelectMenuInteraction,
  User
} from "discord.js";

import _ from 'lodash';
import { parse as parsePath } from 'path';
import { MedleyAutomaton } from '../../automaton';
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { HighlightTextType, makeHighlightedMessage, reply } from '../utils';

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'request',
  description: 'Request a song',
  options: [
    {
      type: OptionType.String,
      name: 'query',
      description: 'Search term',
      autocomplete: true
    },
    {
      type: OptionType.String,
      name: 'artist',
      description: 'Artist name',
      autocomplete: true
    },
    {
      type: OptionType.String,
      name: 'title',
      description: 'Song title',
      autocomplete: true
    }
  ]
}

async function makeRequestPreview(automaton: MedleyAutomaton, index: number = 0, focus?: number) {
  const peeking = automaton.dj.peekRequests(index, 5);

  if (peeking.length <= 0) {
    return;
  }

  const padding = 2 + (_.maxBy(peeking, 'index')?.index.toString().length || 0);

  const previewTrack = (focus?: number) => ({ index, track }: TrackPeek<RequestTrack<User['id']>>) => {
    const label = _.padStart(`${focus === index ? '+ ' : ''}${index + 1}`, padding);
    return `${label}: ${automaton.getTrackBanner(track)} [${track.priority || 0}]`;
  };

  const lines: string[] = [];

  if (peeking[0].index > 1) {
    const first = automaton.dj.peekRequests(0, 1);
    if (first.length) {
      lines.push(previewTrack(focus)(first[0]));
      lines.push(_.padStart('...', padding));
    }
  }

  for (const peek of peeking) {
    lines.push(previewTrack(focus)(peek));
  }

  return lines.length
    ? [
      '```diff',
      ...lines,
      '```'
    ]
    : undefined;
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const options = ['artist', 'title', 'query'].map(f => interaction.options.getString(f));

  if (options.every(_.isNull)) {
    const preview = await makeRequestPreview(automaton);

    if (preview) {
      interaction.reply(preview.join('\n'))
    } else {
      interaction.reply('Request list is empty');
    }

    return;
  }

  await interaction.deferReply();

  const [artist, title, query] = options;

  const results = automaton.dj.search({
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
    label: track.metadata?.tags?.title || parsePath(track.path).name,
    description: track.metadata?.tags?.title ? (track.metadata?.tags?.artist || 'Unknown Artist') : undefined,
    value: track.id,
    collection: track.collection
  }));

  // Distinguish duplicated track artist and title
  _(selections)
    .groupBy(({ label, description }) => `${label}:${description}`)
    .pickBy(group => group.length > 1)
    .forEach(group => {
      for (const sel of group) {
        sel.description += ` (from \'${sel.collection.id}\' collection)`
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
    const collector = selector.createMessageComponentCollector({ componentType: 'SELECT_MENU', time: 30_000 });

    collector.on('collect', async i => {
      if (i.user.id !== issuer) {
        i.reply({
          content: `Sorry, this selection is for <@${issuer}> only`,
          ephemeral: true
        })
        return;
      }

      collector.removeAllListeners();
      await handleSelectMenu(automaton, i);
    });

    collector.on('end', () => {
      if (selector.editable) {
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
        return i.user.id === issuer;
      },
      time: 60_000
    })
    .then(() => {
      collector.removeAllListeners();

      if (selector.deletable) {
        selector.delete();
      }
    })
    .catch(() => void 0);
  }
}

const handleSelectMenu = async (automaton: MedleyAutomaton, interaction: SelectMenuInteraction) => {
  const { values } = interaction;
  if (values.length) {
    const trackId = values[0];
    if (trackId) {
      const ok = await automaton.dj.request(trackId, interaction.member.user.id);

      if (ok === false || ok.index < 0) {
        await interaction.update({
          content: makeHighlightedMessage('Track could not be requested for some reasons', HighlightTextType.Red),
          components: []
        });
        return;
      }

      const preview = await makeRequestPreview(automaton, ok.index, ok.index);
      await interaction.update({
        content: `Request accepted: \`${automaton.getTrackBanner(ok.track)}\``,
        components: []
      });

      if (preview) {
        interaction.followUp({
          content: preview.join('\n')
        })
      }
    }
  }
}

const createAutocompleteHandler: InteractionHandlerFactory<AutocompleteInteraction> = (automaton) => async (interaction) => {
  const { name, value } = interaction.options.getFocused(true);

  const completions = value ? _(automaton.dj.autoSuggest(`${value}`, ['artist', 'title'].includes(name) ? name : undefined))
    .take(25)
    .map<ApplicationCommandOptionChoice>(s => ({ name: s, value: s }))
    .value()
    : []

  // TODO: return some suggestion if query is empty, from search history?, request history?

  interaction.respond(completions);
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createAutocompleteHandler
}

export default descriptor;