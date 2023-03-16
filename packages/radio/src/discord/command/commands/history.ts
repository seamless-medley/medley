import { formatSongBanner } from "@seamless-medley/core";
import { CommandInteraction } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, joinStrings } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'history',
  description: 'Show track history'
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { station } = guildStationGuard(automaton, interaction);

  const trackHistory = await station.trackHistory();

  if (trackHistory.length <= 0) {
    interaction.reply('No track history');
    return;
  }

  let length = 0;
  const lines: string[] = [];
  const history = [...trackHistory].reverse();

  for (const { playedTime, ...record } of history) {
    const banner = formatSongBanner(record.artists, record.title);

    const line = `> **[**<t:${Math.trunc(playedTime.valueOf() / 1000)}:T>**]**: ${banner}`;

    if (length + line.length >= 1000) {
      break;
    }

    lines.unshift(line);
    length += line.length;
  }

  interaction.reply(joinStrings([
    `**Tracks History**`,
    '',
    ...lines
  ]));
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
