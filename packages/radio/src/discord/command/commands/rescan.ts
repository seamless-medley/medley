import { AttachmentBuilder, CommandInteraction, MessageFlags, quote, unorderedList } from "discord.js";
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

  const formatStat = (s: Stat) => {
    let line = `${ formatter.format(s.scanned)} track(s) scanned (${s.elapsedTime.toFixed(2)}s)`

    if (s.added > 0) {
      line += `, ${ formatter.format(s.added)} added`;
    }

    if (s.removed > 0) {
      line += `, ${ formatter.format(s.removed)} removed`;
    }

    if (s.updated > 0) {
      line += `, ${ formatter.format(s.updated)} updated`;
    }

    return line;
  }

  const summary = stats.reduce((a, s) => {
    a.scanned += s.scanned;
    a.added += s.added;
    a.removed += s.removed;
    a.updated += s.updated;
    a.elapsedTime += s.elapsedTime;
    return a;
  }, { scanned: 0, added: 0, removed: 0, updated: 0, elapsedTime: 0 } as Stat)

  const summaryLine = quote(`Summary: ${formatStat(summary)}`);

  const lines: string[] = [];
  let totalLength = 2/*crlf*/ + summaryLine.length;
  for (const s of stats) {
    const line = `${s.collection.extra.description}: ${formatStat(s)}`;
    const lineLength = 2/*unordered list*/ + line.length + 2/*crlf*/;

    if (totalLength + lineLength >= 2000)
      break;

    lines.push(line);
  }

  await reply(interaction, {
    flags: MessageFlags.Ephemeral,
    content: 'Scanned',
    files: [
      new AttachmentBuilder(Buffer.from(joinStrings([
        unorderedList(lines),
        '',
        summaryLine
      ])), { name: 'rescan-result.md' })
    ]
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
