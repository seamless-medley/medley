import { CommandInteraction, blockQuote, inlineCode, unorderedList } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildStationGuard, joinStrings, reply } from "../utils";
import { MusicTrackCollection, Station } from "@seamless-medley/core";

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

  type Stat = {
    scanned: number;
    added: number;
    elapsedTime: number;
  }

  const stats: Array<Stat & { collection: MusicTrackCollection<Station> }> = [];

  for (const col of collections) {
    await reply(interaction, {
      ephemeral: true,
      content: `Re-scanning: ${col.extra.description}`
    });

    const started = performance.now();
    const result = await col.rescan();
    if (result) {
      stats.push({
        ...result,
        collection: col,
        elapsedTime: (performance.now() - started) / 1000
      });
    }
  }

  const formatter = new Intl.NumberFormat();
  const formatNumber = (n: number) => inlineCode(formatter.format(n));
  const formatStat = (s: Stat) => `${formatNumber(s.scanned)} track(s) scanned in ${inlineCode(s.elapsedTime.toFixed(2))} seconds, ${formatNumber(s.added)} track(s) added`;

  const lines = stats.map((s) => {
    return `${s.collection.extra.description}: ${formatStat(s)}`;
  });

  const summary = stats.reduce((a, s) => {
    a.scanned += s.scanned;
    a.added += s.added;
    a.elapsedTime += s.elapsedTime;
    return a;
  }, { scanned: 0, added: 0, elapsedTime: 0 } as Stat)

  await reply(interaction, {
    ephemeral: true,
    content: blockQuote(joinStrings([
      unorderedList(lines),
      '',
      `Summary: ${formatStat(summary)}`
    ]))
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
