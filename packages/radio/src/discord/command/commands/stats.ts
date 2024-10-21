import { ChatInputCommandInteraction, Guild } from "discord.js";
import { AutomatonCommandError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { AutomatonAccess, MedleyAutomaton } from "../../automaton";
import { Station } from "@seamless-medley/core";
import { deny, joinStrings, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'stats',
  description: 'Show statistics',
  options: [
    {
      type: OptionType.Boolean,
      name: 'private',
      description: 'Only you can see the stats',
      required: false
    }
  ]
}

async function guildStats(automaton: MedleyAutomaton, guild: Guild) {
  const state = automaton.getGuildState(guild.id);

  const station = state?.tunedStation;

  return {
    station,
    listeners: station?.getAudiences(automaton.makeAudienceGroup(guild.id))?.size ?? 0
  }
}

function stationStats(station: Station) {
  return {
    listeners: station.audienceCount,
    tracks: station.libraryStats.indexed ?? 0
  }
}

const makeTitle = (...args: any[]) => args.filter(Boolean).join(' - ');

async function showFullStats(interaction: ChatInputCommandInteraction, automaton: MedleyAutomaton) {
  const guildIds = await automaton.client.guilds.fetch().then(guilds => guilds.map(g => g.id));

  const ephemeral = interaction.options.getBoolean('private') ?? true;

  const lines: string[] = [];

  const intl = new Intl.NumberFormat();

  lines.push(
    '# Stats:',
    `- **${intl.format(automaton.stations.size)} Stations**`,
    `- **${intl.format(automaton.totalTracks)} Total Tracks**`,
    `- **${intl.format(automaton.totalListeners)} Total Listeners**`,
    `- **${intl.format(guildIds.length)} Servers**`
  );

  lines.push('## Stations:');

  for (const station of automaton.stations) {
    const { tracks, listeners } = stationStats(station);

    lines.push(
      `- __${makeTitle(station.name, station.description)}__`,
      `  - ${intl.format(tracks)} Tracks`,
      `  - ${intl.format(listeners)} Listeners`,
    );
  }

  lines.push('## Servers:');

  for (const id of guildIds) {
    const guild = automaton.client.guilds.cache.get(id);

    if (guild) {
      lines.push(`- __${makeTitle(guild.name, guild.description)}__`);

      const s = await guildStats(automaton, guild);
      if (!s.station) {
        lines.push('  - No station');
        continue;
      }

      const { station, listeners } = s;
      lines.push(
        `  - Station: ${makeTitle(station.name, station.description)}`,
        `  - ${intl.format(listeners)} Listeners`
      );
    }
  }

  reply(interaction, {
    content: joinStrings(lines),
    ephemeral
  });
}

async function showGuildStats(interaction: ChatInputCommandInteraction, automaton: MedleyAutomaton) {
  if (!interaction.guildId) {
    throw new Error('Not in a guild');
  }

  const guild = await interaction.client.guilds.fetch(interaction.guildId);
  const s = await guildStats(automaton, guild);

  if (!s?.station) {
    deny(interaction, 'No station');
    return;
  }

  const ephemeral = interaction.options.getBoolean('private') ?? false;

  const intl = new Intl.NumberFormat();

  const { station, listeners } = s;

  reply(interaction, {
    content: joinStrings([
      '# Stats:',
      `- Station: ${makeTitle(station.name, station.description)}`,
      `- ${intl.format(station.libraryStats.indexed ?? 0)} Tracks`,
      `- ${intl.format(listeners)} Listeners`
    ]),
    ephemeral
  });
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const access = await automaton.getAccessFor(interaction);

  if (access === AutomatonAccess.Owner) {
    showFullStats(interaction, automaton);
    return;
  }

  if (access >= AutomatonAccess.DJ) {
    if (interaction.inGuild()) {
      showGuildStats(interaction, automaton);
    }
    return;
  }

  throw new AutomatonCommandError(automaton, 'Insufficient permissions');
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
