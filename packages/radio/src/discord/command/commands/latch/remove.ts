import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageActionRowComponentBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
} from "discord.js";

import { guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, permissionGuard, reply } from "../../utils";
import { onGoing } from "./on-going";
import { getLatchSessionsListing } from "./list";
import { interact } from "../../interactor";
import { SubCommandHandlerOptions } from "./type";

export async function remove(options: SubCommandHandlerOptions) {
  const { automaton, interaction } = options;

  const isOwnerOverride = automaton.owners.includes(interaction.user.id);

  if (!isOwnerOverride) {
    permissionGuard(interaction.memberPermissions, [
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.MoveMembers
    ]);
  }


  const { station } = guildStationGuard(automaton, interaction);

  const sessions = station.allLatches;

  if (!sessions.length) {
    reply(interaction, 'Not latching');
    return;
  }

  await interaction.deferReply();

  const selections = sessions.slice(0, 25).map(session => ({
    label: `${session.count}/${session.max} from ${session.collection.extra.description} collection`,
    value: session.uuid
  }));

  await interact({
    commandName: `${options.commandName} ${options.subCommandName}`,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,
    makeCaption: () => ['Latch session:'],
    makeComponents: () => [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('latch_remove')
            .setPlaceholder('Select tracks to cancel')
            .setMinValues(0)
            .setMaxValues(selections.length)
            .addOptions(selections)
        ),

      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('cancel_latch_remove')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        )
    ],

    async onCollect({ collected, done }) {
      if (collected.customId === 'cancel_latch_remove') {
        await done(true);
        return;
      }

      if (!collected.isStringSelectMenu()) {
        return;
      }

      await done(false);

      const removed = collected.values.map(uuid => station.removeLatch(uuid)).filter(session => session !== undefined).length;
      const listing = getLatchSessionsListing(station);

      if (!removed) {
        collected.update({
          components: [],
          content: makeColoredMessage('yellow', 'No latch sessions removed')
        });

        return;
      }

      if (removed && !listing.length) {
        collected.update({
          components: [],
          content: makeColoredMessage('green', 'All latch sessions removed')
        });

        return;
      }

      collected.update({
        components: [],
        content: joinStrings([
          `**${removed} latch session(s)** removed.`,
          'Remaining latch session(s):',
          ...makeAnsiCodeBlock(listing)
        ])
      });
    }
  })
}
