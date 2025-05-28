import { CommandInteraction, MessageFlags, blockQuote, inlineCode, unorderedList } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deferReply, deny, guildStationGuard, joinStrings, reply } from "../utils";
import { once } from "lodash";
import { AutomatonAccess } from "../../automaton";
import { LibraryRescanStats, Station } from "../../../core";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'rescan',
  description: 'Re-scan music collections',
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const access = await automaton.getAccessFor(interaction);

  if (access !== AutomatonAccess.Owner) {
    deny(interaction, 'This command is for the owners only');
    return;
  }

  await deferReply(interaction, { flags: MessageFlags.Ephemeral });

  const { station } = guildStationGuard(automaton, interaction);

  const stats = await station.rescan(true, once(() => {
     reply(interaction, {
      flags: MessageFlags.Ephemeral,
      content: `Re-scanning...`
    });
  }));

  type Stat = Omit<LibraryRescanStats<Station>, 'collection'>;

  const formatter = new Intl.NumberFormat();
  const formatNumber = (n: number) => inlineCode(formatter.format(n));
  const formatStat = (s: Stat) => `${formatNumber(s.scanned)} track(s) scanned in ${inlineCode(s.elapsedTime.toFixed(2))} seconds, ${formatNumber(s.added)} added, ${formatNumber(s.removed)} removed, ${formatNumber(s.updated)} updated`;

  const lines = stats.map((s) => {
    return `${s.collection.extra.description}: ${formatStat(s)}`;
  });

  const summary = stats.reduce((a, s) => {
    a.scanned += s.scanned;
    a.added += s.added;
    a.removed += s.removed;
    a.updated += s.updated;
    a.elapsedTime += s.elapsedTime;
    return a;
  }, { scanned: 0, added: 0, removed: 0, updated: 0, elapsedTime: 0 } as Stat)

  await reply(interaction, {
    flags: MessageFlags.Ephemeral,
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
