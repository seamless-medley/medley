import { getTrackBanner } from "@seamless-medley/core";
import { CommandInteraction } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'history',
  description: 'Show track history'
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { station } = guildStationGuard(automaton, interaction);

  if (station.trackHistory.length <= 0) {
    interaction.reply('No track history');
    return;
  }

  let length = 0;
  const lines: string[] = [];
  const history = [...station.trackHistory].reverse();

  for (const { playedTime, trackPlay: { track }  } of history) {
    const banner = getTrackBanner(track);

    const line = `> **[**<t:${Math.trunc(playedTime.valueOf() / 1000)}:T>**]**: ${banner}`;

    if (length + line.length >= 1000) {
      break;
    }

    lines.unshift(line);
    length += line.length;
  }

  interaction.reply([
    `**Tracks History**`,
    '',
    ...lines
  ].join('\n'));
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;