import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

import { deferReply, guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, reply } from "../../utils";
import { onGoing } from "./on-going";
import { getLatchSessionsListing } from "./list";
import { interact } from "../../interactor";
import { SubCommandHandlerOptions } from "./type";
import { AutomatonPermissionError } from "../../type";
import { AutomatonAccess } from "../../../automaton";

export async function remove(options: SubCommandHandlerOptions) {
  const { automaton, interaction } = options;

  const { station } = guildStationGuard(automaton, interaction);

  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonPermissionError(automaton, interaction);
  }

  const sessions = station.allLatches;

  if (!sessions.length) {
    reply(interaction, 'Not latching');
    return;
  }

  await deferReply(interaction);

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
    makeCaption: async () => ['Latch session:'],
    makeComponents: async () => [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('latch_remove')
            .setPlaceholder('Select latches to cancel')
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
  });
}
