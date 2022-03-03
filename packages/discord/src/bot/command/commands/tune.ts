import { CommandInteraction, Message, MessageActionRow, MessageButton, MessageEmbed, MessageSelectMenu, MessageSelectOptionData, Permissions, SelectMenuInteraction } from "discord.js";
import { MedleyAutomaton } from "../../automaton";
import { Station } from "../../station";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildIdGuard, HighlightTextType, makeHighlightedMessage, permissionGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'tune',
  description: 'Tune into a station'
}

const handleStationSelection = async (automaton: MedleyAutomaton, interaction: SelectMenuInteraction) => {
  permissionGuard(interaction.memberPermissions, [
    Permissions.FLAGS.MANAGE_CHANNELS,
    Permissions.FLAGS.MANAGE_GUILD
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
          new MessageEmbed()
            .setColor('RANDOM')
            .setTitle('Tuned In')
            .addField('Station', ok.name)
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

  const listing = stations.map<MessageSelectOptionData>(station => ({
    label: station.name,
    value: station.id,
    description: station.description,
    default: station.id === currentStationId?.id
  }));

  const selector = await reply(interaction, {
    content: 'Select a station:',
    components: [
      new MessageActionRow()
        .addComponents(
          new MessageSelectMenu()
            .setCustomId('tune')
            .setPlaceholder('Select a station')
            .addOptions(listing)
        ),
      new MessageActionRow()
          .addComponents(
            new MessageButton()
              .setCustomId('cancel_tune')
              .setLabel('Cancel')
              .setStyle('SECONDARY')
              .setEmoji('❌')
        )
    ],
    fetchReply: true
  });

  if (selector instanceof Message) {
    let done = false;

    const collector = selector.createMessageComponentCollector({
      componentType: 'SELECT_MENU',
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
      componentType: 'BUTTON',
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

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => createStationSelector(automaton, interaction);

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;