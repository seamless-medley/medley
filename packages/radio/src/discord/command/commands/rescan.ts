import { CommandInteraction, quote } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildStationGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'rescan',
  description: 'Re-scan music collections',
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const isOwner = automaton.owners.includes(interaction.user.id);

  if (!isOwner) {
    deny(interaction, 'This command is for the owner only');
    return;
  }

  const { station } = guildStationGuard(automaton, interaction);

  await interaction.deferReply({
    ephemeral: true
  });

  const { collections } = station;

  const counter = {
    scanned: 0,
    added: 0
  }

  for (const col of collections) {
    await reply(interaction, {
      ephemeral: true,
      content: `Re-scanning: ${col.extra.description}`
    });

    const result = await col.rescan();
    if (result) {
      counter.scanned += result.scanned;
      counter.added += result.added;
    }
  }

  await reply(interaction, {
    ephemeral: true,
    content: quote(`Done: ${counter.scanned} tracks scanned, ${counter.added} track(s) added`)
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
