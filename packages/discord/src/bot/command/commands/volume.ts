import { decibelsToGain, gainToDecibels } from "@seamless-medley/core";
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

const g2d = (g: number) => round(gainToDecibels(g));

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = ({ station }) => async (interaction) => {
  const { guildId } = interaction;

  if (!guildId) {
    return;
  }

  const oldGain = station.getGain(guildId);
  const decibels = interaction.options.getNumber('db');

  if (decibels === null) {
    accept(interaction, `Current volume: ${g2d(oldGain)}dB`);
    return;
  }

  if (station.setGain(guildId, decibelsToGain(decibels))) {
    accept(interaction, `OK: Fading volume from ${g2d(oldGain)}dB to ${round(decibels, 2)}dB`);
  } else {
    warn(interaction, 'Not in a voice channel');
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;