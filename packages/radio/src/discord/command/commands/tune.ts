import {
  CommandInteraction,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ButtonStyle,
  ComponentType,
  MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  SelectMenuComponentOptionData
} from "discord.js";
import { stubTrue } from "lodash";

import { MedleyAutomaton } from "../../automaton";
import { formatMention } from "../../format/format";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { reply, deny, guildIdGuard, permissionGuard, makeColoredMessage } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'tune',
  description: 'Tune into a station'
}

const handleStationSelection = async (automaton: MedleyAutomaton, interaction: StringSelectMenuInteraction) => {
  permissionGuard(interaction.memberPermissions, [
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.MoveMembers
  ]);

  const guildId = guildIdGuard(interaction);

  const { values: [stationId] } = interaction;

  if (stationId) {
    await interaction.deferUpdate();

    const station = automaton.stations.get(stationId)!;

    await reply(interaction, {
      content: `Tuning into ${station.name}`,
      components: [],
      embeds: []
    });

    const ok = await automaton.ensureGuildState(guildId).tune(station);

    if (ok) {
      const embed = new EmbedBuilder()
        .setColor('Random')
        .setTitle('Tuned In')
        .addFields({
          name: 'Station',
          value: station.url ? `[${station.name}](${station.url})` : station.name
        });

      if (station.iconURL) {
        embed.setThumbnail(station.iconURL);
      }

      await reply(interaction, {
        content: null,
        components: [],
        embeds: [embed]
      });

      return true;
    }

    await reply(interaction, {
      content: makeColoredMessage('red', 'Could not tune into that station'),
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

  const preferredStation = interaction.guildId ? automaton.getGuildState(interaction.guildId)?.preferredStation : undefined;

  const issuer = interaction.user.id;

  const listing = stations.map<SelectMenuComponentOptionData>(station => ({
    label: station.name,
    value: station.id,
    description: station.description,
    default: station.id === preferredStation?.id
  }));

  const selector = await reply(interaction, {
    content: 'Select a station:',
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
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

    const collector = selector.createMessageComponentCollector({ time: 30_000 });

    collector.on('collect', async i => {
      if (i.user.id !== issuer) {
        reply(i, {
          content: `Sorry, this selection is for ${formatMention('user', issuer)} only`,
          ephemeral: true
        })
        return;
      }

      done = true;
      collector.stop();

      if (i.customId === 'tune' && i.componentType === ComponentType.StringSelect) {
        const ok = await handleStationSelection(automaton, i).catch(stubTrue);
        await onDone?.(ok);
        return;
      }

      if (i.customId === 'cancel_tune') {
        if (selector.deletable) {
          selector.delete();
        }

        return;
      }
    });

    collector.on('end', () => {
      if (!done && selector.editable) {
        selector.edit({
          content: makeColoredMessage('yellow', 'Timed out, please try again'),
          components: []
        });
      }
    });
  }
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => (interaction) => {
  permissionGuard(interaction.memberPermissions, [
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.MoveMembers
  ]);

  return createStationSelector(automaton, interaction);
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
