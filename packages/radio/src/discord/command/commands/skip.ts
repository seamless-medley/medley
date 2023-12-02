import { isRequestTrack, Audience, StationTrack } from "@seamless-medley/core";
import { ButtonInteraction, CommandInteraction, PermissionsBitField, userMention } from "discord.js";
import { MedleyAutomaton } from "../../automaton";
import { extractRequestersForGuild } from "../../trackmessage/creator/base";
import { ansi } from "../../format/ansi";
import { CommandDescriptor,  InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { declare, deny, guildStationGuard, makeAnsiCodeBlock, reply, warn } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'skip',
  description: 'Skip to the next track'
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> =
  (automaton) => (interaction) => handleSkip(automaton, interaction);


async function handleSkip(automaton: MedleyAutomaton, interaction: CommandInteraction | ButtonInteraction) {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const state = automaton.getGuildState(guildId);

  if (!state) {
    deny(interaction, 'No station linked');
    return;
  }

  const { trackPlay } = station;

  if (trackPlay && isRequestTrack<StationTrack, Audience>(trackPlay.track)) {
    const canSkip = automaton.owners.includes(interaction.user.id);

    if (!canSkip) {
      const { requestedBy } = trackPlay.track;

      const isRequester = requestedBy.some(r => r.id === interaction.user.id);

      if (!isRequester) {
        const requesters = extractRequestersForGuild(guildId, requestedBy);
        const mentions = requesters.length > 0 ? requesters.map(id => userMention(id)).join(' ') : '`Someone else`';
        await reply(interaction, `${userMention(interaction.user.id)} Could not skip this track, it was requested by ${mentions}`);
        return;
      }
    }
  }

  const noPermissions = !interaction.memberPermissions?.any([
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.MoveMembers
  ]);

  if (noPermissions) {
    await deny(interaction,
      'You are not allowed to do that',
      { mention: { type: 'user', subject: interaction.user.id }}
    );
    return;
  }

  if (station.paused || !station.playing) {
    await deny(interaction,
      'Not currently playing',
      { mention: { type: 'user', subject: interaction.user.id }}
    );
    return;
  }

  const result = automaton.skipCurrentSong(guildId);

  if (result === true) {
    await declare(interaction,
      makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, {{blue}}Skipping to the next track`),
      { mention: { type: 'user', subject: interaction.user.id }}
    );
    return;
  }

  await warn(interaction, 'Track skipping has been denied');
}

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, playUuid: string) => {
  const { station } = guildStationGuard(automaton, interaction);

  if (station.trackPlay?.uuid !== playUuid) {
    await deny(interaction, 'Could not skip this track', { ephemeral: true });
    return;
  }

  return handleSkip(automaton, interaction);
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createButtonHandler
}

export default descriptor;
