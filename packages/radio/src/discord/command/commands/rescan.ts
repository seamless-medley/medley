import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, CommandInteraction, FileBuilder, MessageActionRowComponentBuilder, MessageFlags, quote, SelectMenuComponentOptionData, StringSelectMenuBuilder, TextDisplayBuilder, unorderedList } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deferReply, deny, guildStationGuard, joinStrings, reply } from "../utils";
import { chain, once, remove, startCase, uniqBy } from "lodash";
import { AutomatonAccess } from "../../automaton";
import { LibraryRescanStats, Station } from "../../../core";
import { interact } from "../interactor";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'rescan',
  description: 'Re-scan music collections'
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const access = await automaton.getAccessFor(interaction);

  if (access !== AutomatonAccess.Owner) {
    deny(interaction, 'This command is for the owners only');
    return;
  }

  const { station } = guildStationGuard(automaton, interaction);

  await deferReply(interaction, { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });

  const collectionIds = station.collections.map(c => c.id);

  const listing = chain(station.collections)
    .map<SelectMenuComponentOptionData>(c => ({
      label: c.extra.description ?? startCase(c.id),
      description: `${c.length} track(s)`,
      value: c.id,
    }))
    .unshift({
      label: 'All',
      description: 'Re-scan all collections',
      value: '_all'
    })
    .value();

  const selections = {
    collections: [] as string[],
    flags: {
      detectAddition: true,
      detectRemoval: true,
      updateExisting: false
    }
  }

  const doRescan = async () => {
    const stats = await station.rescan({
      onlyCollections: selections.collections,
      flags: selections.flags
    }, once(() => {
      reply(interaction, {
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          new TextDisplayBuilder()
            .setContent(`Re-scanning...`)
        ]
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

    interaction.editReply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [
        new TextDisplayBuilder()
          .setContent(`Scanned`)
      ]
    });

    interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: 'Result',
      files: [
        new AttachmentBuilder(Buffer.from(joinStrings([
          unorderedList(lines),
          '',
          summaryLine
        ])), { name: 'rescan-result.md' })
      ]
    });
  }

  await interact({
    commandName: 'rescan',
    automaton,
    interaction,
    ttl: 90_000,
    useComponentV2: true,
    ephemeral: true,
    async makeCaption() {
      return ['Rescan']
    },

    async makeComponents() {
      type MenuItem = [id: string, choices: [yes: string, no: string], defaultIndex: 0 | 1];

      const menus: MenuItem[] = [
        ['new', ['Detect new tracks', 'Skip new tracks detection'], 0],
        ['removed', ['Detect removed tracks', 'Skip removed tracks detection'], 0],
        ['updated', ['Detect updated tracks', 'Skip updated tracks detection'], 1]
      ];

      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('collections')
              .setPlaceholder('Select collections')
              .setMinValues(0)
              .setMaxValues(listing.length)
              .addOptions(listing)
          ),

        ...menus.map(([id, choices, defIndex]) => new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(new StringSelectMenuBuilder()
            .setCustomId(`rescan_${id}`)
            .setPlaceholder(choices[defIndex])
            .addOptions(['yes', 'no'].map((value, index) => ({
              label: choices[index],
              value,
              default: index === defIndex
            })))
          ),
        ),

        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('rescan_confirm')
              .setLabel('Confirm')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('✅'),

            new ButtonBuilder()
                .setCustomId('rescan_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❌')
          )
      ]
    },

    async onCollect({ collected, buildMessage, resetTimer, done }) {
      const { customId } = collected;

      if (customId === 'rescan_cancel') {
        await done();
        return;
      }

      resetTimer();

      if (collected.isStringSelectMenu()) {
        collected.deferUpdate();

        if (['rescan_new', 'rescan_removed', 'rescan_updated'].includes(customId)) {
          const flag = collected.values?.at(0) === 'yes';

          switch (customId) {
            case 'rescan_new':
              selections.flags.detectAddition = flag;
              break;
            case 'rescan_removed':
              selections.flags.detectRemoval = flag;
              break;
            case 'rescan_updated':
              selections.flags.updateExisting = flag;
              break;
          }

          return;
        }

        if (customId === 'collections') {
          const collections = collected.values ?? [];

          selections.collections = collections.includes('_all')
             ? collectionIds
             : collections;

          return;
        }

        return;
      }

      if (customId === 'rescan_confirm') {
        const timerId = setInterval(resetTimer, 2000);
        await doRescan();
        await done(false);
        clearInterval(timerId);
        return;
      }
    }
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
