import { parse as parsePath } from 'path';
import { CommandInteraction, Message, MessageActionRow, MessageButton, MessageSelectMenu, MessageSelectOptionData } from "discord.js";
import { truncate } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, reply, accept, makeHighlightedMessage, HighlightTextType } from "../utils";
import { AudienceType, makeRequestAudience } from '@seamless-medley/core';

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'unrequest',
  description: 'Cancel requested song(s)',
  options: [
    {
      type: OptionType.Boolean,
      name: 'all',
      description: 'Cancel all requests',
      required: false
    }
  ]
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const all = interaction.options.getBoolean('all');

  const ephemeral = true;
  await interaction.deferReply({ ephemeral });

  const requests = station.getRequestsOf(makeRequestAudience(AudienceType.Discord, guildId, interaction.user.id));

  if (requests.length < 1) {
    reply(interaction, {
      ephemeral: true,
      content: 'No requests found'
    });

    return;
  }

  if (all) {
    accept(interaction, 'OK, cancel all your requests', undefined, ephemeral);
    station.unrequest(requests.map(r => r.rid));
    return;
  }

  const selections = requests.slice(0, 25).map<MessageSelectOptionData>(request => ({
    label: truncate(request.metadata?.tags?.title || parsePath(request.path).name, { length: 100 }),
    description: request.metadata?.tags?.title ? truncate(request.metadata?.tags?.artist || 'Unknown Artist', { length: 100 }) : undefined,
    value: request.rid.toString(36),
  }));


  const selector = await reply(interaction, {
    ephemeral,
    fetchReply: true,
    content: 'Requests:',
    components: [
      new MessageActionRow()
        .addComponents(
          new MessageSelectMenu()
            .setCustomId('unrequest')
            .setPlaceholder('Select tracks to cancel')
            .setMinValues(0)
            .setMaxValues(selections.length)
            .addOptions(selections)
        ),

      new MessageActionRow()
        .addComponents(
          new MessageButton()
            .setCustomId('cancel_unrequest')
            .setLabel('Cancel')
            .setStyle('SECONDARY')
            .setEmoji('❌')
        )
    ]
  });

  if (selector instanceof Message) {
    let done = false;

    const collector = selector.createMessageComponentCollector({ componentType: 'SELECT_MENU', time: 90_000 });

    collector.on('collect', async i => {
      done = true;
      collector.stop();

      const requestIds = i.values.map(v => parseInt(v, 36));
      station.unrequest(requestIds);

      i.update({
        components: [],
        content: makeHighlightedMessage(`OK, ${requestIds.length} track(s) canceled`, HighlightTextType.Cyan)
      });

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
      filter: i => {
        i.deferUpdate();
        return i.customId === 'cancel_unrequest';
      },
      time: 90_000
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

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
