import { getTrackBanner } from "@seamless-medley/core";
import { CommandInteraction } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'history',
  description: 'Show track history'
}

const timeFormatter = Intl.DateTimeFormat([], { hourCycle: 'h24', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tzFormatter = Intl.DateTimeFormat([], { timeZoneName: 'short' });

const formatTime = (date: Date) => timeFormatter.formatToParts(date).map(p => p.value).join('');
const formatTz = (date: Date) => tzFormatter.formatToParts(date).find(p => p.type === 'timeZoneName')?.value;

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
    const line = `**[**\`${formatTime(playedTime)}\`**]**: ${banner}`;

    if (length + line.length >= 1000) {
      break;
    }

    lines.unshift(line);
    length += line.length;
  }

  const tz = formatTz(new Date);
  const timeZoneInfo = tz ? ` (Time displayed in ${tz} time zone)` : '';

  interaction.reply([
    `**Track History**${timeZoneInfo}`,
    '',
    ...lines
  ].join('\n'));
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;