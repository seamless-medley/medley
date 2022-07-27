import {
  CommandInteraction,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  SelectMenuBuilder,
  PermissionsBitField,
  SelectMenuInteraction,
  ButtonStyle,
  ComponentType,
  MessageActionRowComponentBuilder
} from "discord.js";

import { MedleyAutomaton } from "../../automaton";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildIdGuard, HighlightTextType, makeHighlightedMessage, permissionGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'tune',
  description: 'Tune into a station'
}

const handleStationSelection = async (automaton: MedleyAutomaton, interaction: SelectMenuInteraction) => {
  permissionGuard(interaction.memberPermissions, [
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild
  ]);

  const guildId = guildIdGuard(interaction);

  const { values: [stationId] } = interaction;

  if (stationId) {
    const ok = await automaton.tune(guildId, automaton.stations.get(stationId));

    if (ok) {
      await interaction.update({
        content: null,
        components: [],
        embeds: [
          new EmbedBuilder()
            .setColor('Random')
            .setTitle('Tuned In')
            .addFields({ name: 'Station', value: ok.name })
        ]
      });

      return true;
    }

    await interaction.update({
      content: makeHighlightedMessage('Could not tune into that station', HighlightTextType.Red),
      components: []
    });
  }

  return false;
}

export async function createStationSelector(automaton: MedleyAutomaton, interaction: CommandInteraction, onDone?: (ok: boolean) => Promise<any>) {
  const stations = automaton.stations.all();

  if (stations.length <= 0) {
    deny(interaction, 'No stations were defined')
    return;
  }

  const currentStationId = interaction.guildId ? automaton.getGuildStation(interaction.guildId) : undefined;

  const issuer = interaction.user.id;

  const listing = stations.map(station => ({
    label: station.name,
    value: station.id,
    description: station.description,
    default: station.id === currentStationId?.id
  }));

  const selector = await reply(interaction, {
    content: 'Select a station:',
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new SelectMenuBuilder()
            .setCustomId('tune')
            .setPlaceholder('Select a station')
            .addOptions(listing)
        ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('cancel_tune')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
        )
    ],
    fetchReply: true
  });

  if (selector instanceof Message) {
    let done = false;

    const collector = selector.createMessageComponentCollector({
      componentType: ComponentType.SelectMenu,
      time: 30_000
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
      //
      const ok = await handleStationSelection(automaton, i);
      await onDone?.(ok);
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
      componentType: ComponentType.Button,
      filter: (i) => {
        i.deferUpdate();
        return i.customId === 'cancel_tune' && i.user.id === issuer;
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

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => (interaction) => createStationSelector(automaton, interaction);

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
