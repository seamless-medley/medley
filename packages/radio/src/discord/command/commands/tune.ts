import {
  CommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ButtonStyle,
  MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  SelectMenuComponentOptionData,
  hyperlink
} from "discord.js";
import { stubTrue } from "lodash";

import { MedleyAutomaton } from "../../automaton";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { reply, deny, guildIdGuard, permissionGuard, makeColoredMessage } from "../utils";
import { interact } from "../interactor";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'tune',
  description: 'Tune into a station'
}

const handleStationSelection = async (automaton: MedleyAutomaton, interaction: StringSelectMenuInteraction) => {
  const isOwnerOverride = automaton.owners.includes(interaction.user.id);

  if (!isOwnerOverride) {
    permissionGuard(interaction.memberPermissions, [
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.MoveMembers
    ]);
  }

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
          value: station.url ? hyperlink(station.name, station.url) : station.name
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

const onGoing = new Set<string>();

export async function createStationSelector(automaton: MedleyAutomaton, interaction: CommandInteraction, onDone?: (ok: boolean) => Promise<any>) {
  const stations = automaton.stations.all();

  if (stations.length <= 0) {
    deny(interaction, 'No stations were defined')
    return;
  }

  const preferredStation = interaction.guildId
    ? automaton.getGuildState(interaction.guildId)?.preferredStation
    : undefined;

  await interact({
    commandName: declaration.name,
    automaton,
    interaction,
    onGoing,
    makeCaption: () => [],
    makeComponents() {
      const listing = stations.map<SelectMenuComponentOptionData>(station => ({
        label: station.name,
        value: station.id,
        description: station.description,
        default: station.id === preferredStation?.id
      }));

      return [
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
      ];
    },

    async onCollect({ collected, done }) {
      const { customId } = collected;

      if (customId === 'cancel_tune') {
        await done();
        return;
      }

      if (customId === 'tune' && collected.isStringSelectMenu()) {
        const ok = await handleStationSelection(automaton, collected).catch(stubTrue);
        await onDone?.(ok);
        return;
      }
    }
  })
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => (interaction) => {
  const isOwnerOverride = automaton.owners.includes(interaction.user.id);

  if (!isOwnerOverride) {
    permissionGuard(interaction.memberPermissions, [
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.MoveMembers
    ]);
  }

  return createStationSelector(automaton, interaction);
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
