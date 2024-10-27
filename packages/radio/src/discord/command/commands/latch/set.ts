import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageActionRowComponentBuilder,
  SelectMenuComponentOptionData,
  StringSelectMenuBuilder,
} from "discord.js";

import { deferReply, guildStationGuard, joinStrings, makeAnsiCodeBlock, makeColoredMessage, warn } from "../../utils";
import { isString, range, startCase } from "lodash";
import { ansi } from "../../../format/ansi";
import { onGoing } from "./on-going";
import { interact } from "../../interactor";
import { SubCommandHandlerOptions } from "./type";
import { AutomatonPermissionError } from "../../type";
import { AutomatonAccess } from "../../../automaton";

export async function set(options: SubCommandHandlerOptions) {
  const { automaton, interaction } = options;

  const { station } = guildStationGuard(automaton, interaction);

  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonPermissionError(automaton, interaction);
  }

  // All collections from station's library
  const collections = station.collections.filter(c => c.length > 0 && !c.latchDisabled);

  if (collections.length <= 1) {
    warn(interaction, 'Nothing to latch');
    return;
  }

  await deferReply(interaction);

  const selections: Record<string, string | undefined> = {
    collection: station.trackPlay?.track?.collection?.id,
    more: undefined
  }

  const error: { text?: string } = {};

  const doLatch = async (increase: boolean) => {
    if (!selections.collection || !selections.more) {
      return 'Invalid parameter';
    }

    const collection = station.getCollection(selections.collection);
    if (!collection) {
      return 'Invalid parameter';
    }

    const latching = station.latch({
      collection,
      ...(increase
        ? { increase: Number(selections.more) }
        : { increase: false, length: Number(selections.more) }
      )
    });

    if (latching === undefined) {
      return "Lacthing was denied by the station's sequencer";
    }

    return latching;
  }

  await interact({
    commandName: `${options.commandName} ${options.subCommandName}`,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,

    makeCaption: async () => [
      'Latch:',
      error.text ? makeColoredMessage('red|b', error.text) : undefined
    ],

    async makeComponents() {
      const listing = collections.map<SelectMenuComponentOptionData>(c => ({
        label: c.extra.description ?? startCase(c.id),
        description: `${c.length} track(s)`,
        value: c.id,
        default: c.id === selections.collection
      }));

      const counters = range(1, 20 + 1).map<SelectMenuComponentOptionData>(n => ({
        label: `${n}`,
        value: `${n}`,
        default: `${n}` === selections.more
      }));

      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('collection')
            .setPlaceholder('collection')
            .addOptions(listing)
        ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
          .setCustomId('more')
            .setPlaceholder('How many?')
            .addOptions(counters)
        ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('latch_set')
            .setLabel('Set')
            .setDisabled(!selections.collection || !selections.more)
            .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
            .setCustomId('latch_inc')
            .setLabel('Add')
            .setDisabled(!selections.collection || !selections.more)
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId('latch_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        )
      ]
    },

    async onCollect({ selector, collected, buildMessage, resetTimer, done }) {
      const { customId } = collected;
      error.text = undefined;

      if (customId === 'latch_cancel') {
        await done();
        return;
      }

      if (['latch_set', 'latch_inc'].includes(customId)) {
        const latching = await doLatch(customId === 'latch_inc');

        if (!isString(latching)) {
          const { description = latching.collection.id } = latching.collection.extra;

          await selector.edit({
            content: joinStrings(
              makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Latching collection {{bgOrange}} {{white|u}}${description}{{bgOrange|n}} {{reset}} for {{pink|b}}${latching.max}{{reset}} tracks`)
            ),
            components: []
          });

        } else {
          collected.reply({
            content: makeColoredMessage('red|b', latching),
            ephemeral: true
          });
        }

        await done(false);
        return;
      }

      if (['collection', 'more'].includes(customId) && collected.isStringSelectMenu()) {
        resetTimer();

        selections[collected.customId] = collected.values?.at(0);

        await collected.update(await buildMessage());
      }
    },

    hook({ cancel }) {
      const handleStationChange = () => {
        cancel('Canceled, the station has been changed');
      }

      automaton.on('stationTuned', handleStationChange);

      return () => {
        automaton.off('stationTuned', handleStationChange);
      }
    },
  });
}
