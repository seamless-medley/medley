import { parse as parsePath } from 'path';
import { CommandInteraction, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageActionRowComponentBuilder, StringSelectMenuBuilder, userMention } from "discord.js";
import { chain, truncate } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, reply, makeColoredMessage, makeAnsiCodeBlock, joinStrings } from "../utils";
import { AudienceType, BoomBoxTrack, TrackWithRequester, getTrackBanner, isRequestTrack, makeAudience } from '@seamless-medley/core';
import { ansi } from '../../format/ansi';
import { interact } from '../interactor';

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'unrequest',
  description: 'Cancel requested song(s)'
}

const onGoing = new Set<string>();

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const requests = station.getRequestsOf(
    makeAudience(
      AudienceType.Discord,
      { automatonId: automaton.id, guildId },
      interaction.user.id
    )
  );

  if (requests.length < 1) {
    reply(interaction, {
      content: 'No requests found'
    });

    return;
  }

  await interaction.deferReply();

  const selections = requests.slice(0, 25).map(request => ({
    label: truncate(request.extra?.tags?.title || parsePath(request.path).name, { length: 100 }),
    description: request.extra?.tags?.title ? truncate(request.extra?.tags?.artist || 'Unknown Artist', { length: 100 }) : undefined,
    value: request.rid.toString(36),
  }));

  await interact({
    commandName: declaration.name,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,

    makeCaption: () => ['Requests:'],
    makeComponents: () => [
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
            .setCustomId('cancel_unrequest')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        )
    ],

    async onCollect({ collected, done }) {
      if (!collected.isStringSelectMenu()) {
        return;
      }

      await done(false);

      const requestIds = collected.values.map(v => parseInt(v, 36));
      const unrequested = station.unrequest(requestIds);

      const banners = unrequested.removed.map(getTrackBanner);
      const loadedRequests = chain([0, 1, 2])
        .map(i => station.getDeckInfo(i).trackPlay?.track)
        .filter((t): t is TrackWithRequester<BoomBoxTrack, any> => isRequestTrack(t) && requestIds.includes(t.rid))
        .value();

      collected.update({
        components: [],
        content: joinStrings([
          ...makeAnsiCodeBlock([
            ansi`{{green}}OK{{reset}}, {{pink}}${banners.length}{{reset}} track(s) canceled`,
            ...banners
          ]),
          ...(loadedRequests.length
            ? makeAnsiCodeBlock([
              'The following track(s) are already loaded and cannot be cancelled',
              ...loadedRequests.map(getTrackBanner)
            ])
            : []
          )
        ])
      });
    }
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
