import { decibelsToGain, gainToDecibels } from "@medley/core";
import { CommandInteraction } from "discord.js";
import { round } from "lodash";
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
      description: 'Volume in Decibels, -60 <= db <= 3',
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

  const oldGain = dj.getGain(interaction.guildId);

  if (dj.setGain(interaction.guildId, decibelsToGain(decibels))) {
    accept(interaction, `OK: Fading volume from ${round(gainToDecibels(oldGain), 2)}dB to ${round(decibels, 2)}dB`);
  } else {
    warn(interaction, 'Not in a voice channel');
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;