import { parse as parsePath } from 'path';
import { CommandInteraction, Message, ActionRowBuilder, ButtonBuilder, SelectMenuBuilder, ButtonStyle, ComponentType, MessageActionRowComponentBuilder } from "discord.js";
import { truncate } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, reply, makeHighlightedMessage, HighlightTextType } from "../utils";
import { AudienceType, isRequestTrack, makeRequestAudience } from '@seamless-medley/core';

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'unrequest',
  description: 'Cancel requested song(s)'
}

const onGoing = new Set<string>();

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  await interaction.deferReply();

  const requests = station.getRequestsOf(makeRequestAudience(AudienceType.Discord, guildId, interaction.user.id));

  if (requests.length < 1) {
    reply(interaction, {
      content: 'No requests found'
    });

    return;
  }

  const issuer = interaction.user.id;

  const runningKey = `${guildId}:${issuer}`;

  if (onGoing.has(runningKey)) {
    reply(interaction, 'Finish the ealier `unrequest` command, please');
    return;
  }

  const selections = requests.slice(0, 25).map(request => ({
    label: truncate(request.metadata?.tags?.title || parsePath(request.path).name, { length: 100 }),
    description: request.metadata?.tags?.title ? truncate(request.metadata?.tags?.artist || 'Unknown Artist', { length: 100 }) : undefined,
    value: request.rid.toString(36),
  }));

  const selector = await reply(interaction, {
    // ephemeral,
    fetchReply: true,
    content: 'Requests:',
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new SelectMenuBuilder()
            .setCustomId('unrequest')
            .setPlaceholder('Select tracks to cancel')
            .setMinValues(0)
            .setMaxValues(selections.length)
            .addOptions(selections)
        ),

      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('cancel_unrequest')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        )
    ]
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

      const requestIds = i.values.map(v => parseInt(v, 36));
      const unrequested = station.unrequest(requestIds);

      let alreadyLoaded = false;

      if (unrequested.invalid) {
        alreadyLoaded = [0, 1, 2]
          .map(i => station.getDeckInfo(i).trackPlay?.track)
          .filter(isRequestTrack)
          .some(t => requestIds.includes(t.rid))
      }

      i.update({
        components: [],
        content: makeHighlightedMessage([
          `OK, ${unrequested.removed.length} track(s) canceled`,
          alreadyLoaded ? 'Some tracks are loaded' : undefined
        ], HighlightTextType.Cyan)
      });
    });

    collector.on('end', x => {
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
      filter: i => {
        i.deferUpdate();
        return i.customId === 'cancel_unrequest' && i.user.id === issuer;
      },
      idle: 90_000
    })
    .then(i => {
      if (!done) {
        done = true;
        collector.stop();

        onGoing.delete(runningKey);

        if (selector.deletable) {
          selector.delete();
        }
      }
    })
    .catch(() => onGoing.delete(runningKey));
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
