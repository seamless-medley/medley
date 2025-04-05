import { bold, CommandInteraction, quote, time as formatTime } from "discord.js";
import { formatSongBanner } from "@seamless-medley/utils";
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
    const banner = formatSongBanner({
      artists: record.artists,
      title: record.title
    });

    const line = quote(`${bold('[')}${formatTime(playedTime, 'T')}${bold(']')}: ${banner}`);

    if (length + line.length >= 1000) {
      break;
    }

    lines.unshift(line);
    length += line.length;
  }

  interaction.reply(joinStrings([
    bold('Tracks History'),
    '',
    ...lines
  ]));
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
