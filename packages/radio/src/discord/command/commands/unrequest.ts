import { parse as parsePath } from 'node:path';
import { ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder, StringSelectMenuBuilder } from "discord.js";
import { truncate } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, reply, makeAnsiCodeBlock, joinStrings, deferReply } from "../utils";
import { AudienceType, getTrackBanner, makeRequester } from '@seamless-medley/core';
import { ansi } from '../../format/ansi';
import { interact } from '../interactor';

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'unrequest',
  description: 'Cancel requested song(s)'
}

const onGoing = new Set<string>();

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const requester = makeRequester(
    AudienceType.Discord,
    { automatonId: automaton.id, guildId },
    interaction.user.id
  );

  const requests = station.getRequestsOf(requester);

  if (requests.length < 1) {
    reply(interaction, {
      content: 'No requests found'
    });

    return;
  }

  await deferReply(interaction);

  const selections = requests.slice(0, 25).map(request => ({
    label: truncate(request.extra?.tags?.title || parsePath(request.path).name, { length: 100 }),
    description: request.extra?.tags?.title ? truncate(request.extra?.tags?.artist || 'Unknown Artist', { length: 100 }) : undefined,
    value: request.rid.toString(36),
  }));

  let requestIds: number[] = [];

  await interact({
    commandName: declaration.name,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,

    makeCaption: async () => ['Requests:'],
    makeComponents: async () => [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('unrequest')
            .setPlaceholder('Select tracks to remove')
            .setMinValues(0)
            .setMaxValues(selections.length)
            .addOptions(selections)
        ),
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('unrequest_confirm')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✅'),

          new ButtonBuilder()
            .setCustomId('unrequest_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        )
    ],

    async onCollect({ collected, done }) {
      const { customId } = collected;

      if (customId === 'unrequest_cancel') {
        await done();
        return;
      }

      if (customId === 'unrequest' && collected.isStringSelectMenu()) {
        requestIds = collected.values.map(v => parseInt(v, 36));
        collected.deferUpdate();
        return;
      }

      if (customId === 'unrequest_confirm') {
        await done(false);

        const unrequested = station.unrequest(requestIds, requester);

        const banners = unrequested.removed.map(getTrackBanner);
        const loadedRequests = station.getFetchedRequests()
          .filter(({ rid }) => requestIds.includes(rid));

        station.sortRequests(true);

        collected.update({
          components: [],
          content: joinStrings([
            ...makeAnsiCodeBlock([
              ansi`{{green}}OK{{reset}}, {{pink}}${banners.length}{{reset}} track(s) canceled`,
              '',
              ...banners.map(s => `- ${s}`)
            ]),
            ...(loadedRequests.length
              ? makeAnsiCodeBlock([
                'The following track(s) are already loaded and cannot be cancelled',
                ...loadedRequests.map(t => `- ${getTrackBanner(t)}`)
              ])
              : []
            )
          ])
        });
      }
    }
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
