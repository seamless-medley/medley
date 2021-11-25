import { decibelsToGain, gainToDecibels } from "@medley/core";
import { CommandInteraction } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { accept, warn } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'volume',
  description: 'Set volume',
  options: [
    {
      type: OptionType.Number,
      name: 'db',
      description: 'Volume in Decibels',
      min_value: -60,
      max_value: 3,
      required: false
    }
  ]
}


const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = ({ dj }) => async (interaction) => {
  const decibels = interaction.options.getNumber('db');
  if (decibels === null) {
    accept(interaction, `Current volume: ${gainToDecibels(dj.getGain(interaction.guildId))}dB`);
    return;
  }

  if (dj.setGain(interaction.guildId, decibelsToGain(decibels))) {
    accept(interaction, `OK: Volume set to ${decibels}dB`);
  } else {
    warn(interaction, 'Not in a voice channel');
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;