import { AudienceType, extractAudienceGroup, isRequestTrack, RequestAudience } from "@seamless-medley/core";
import { ButtonInteraction, CommandInteraction, PermissionsBitField } from "discord.js";
import { MedleyAutomaton } from "../../automaton";
import { CommandDescriptor,  InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { accept, deny, guildStationGuard, permissionGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'skip',
  description: 'Skip to the next track'
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> =
  (automaton) => (interaction) => handleSkip(automaton, interaction);


async function handleSkip(automaton: MedleyAutomaton, interaction: CommandInteraction | ButtonInteraction) {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  permissionGuard(interaction.memberPermissions, [
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.MoveMembers
  ]);

  const { trackPlay } = station;

  if (trackPlay && isRequestTrack<RequestAudience>(trackPlay.track)) {
    let canSkip = automaton.owners.includes(interaction.user.id);

    if (!canSkip) {
      const { requestedBy } = trackPlay.track;

      canSkip = requestedBy.some(r => r.id === interaction.user.id);

      if (!canSkip) {
        const requesters = requestedBy
          .map(({ group, id }) => ({
            ...extractAudienceGroup(group),
            id
          }))
          .filter(({ type, groupId }) => type === AudienceType.Discord && groupId === guildId)
          .map(r => r.id);

        const mentions = requesters.length > 0 ? requesters.map(id =>  `<@${id}>`).join(' ') : '`Someone else`';
        await reply(interaction, `<@${interaction.user.id}> Could not skip this track, it was requested by ${mentions}`);
        return;
      }
    }
  }

  if (station.paused || !station.playing) {
    await deny(interaction, 'Not currently playing', `@${interaction.user.id}`);
    return;
  }

  await accept(interaction, `OK: Skipping to the next track`, `@${interaction.user.id}`);
  automaton.skipCurrentSong(guildId);
}

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, playUuid: string) => {
  const { station } = guildStationGuard(automaton, interaction);

  if (station.trackPlay?.uuid !== playUuid) {
    deny(interaction, 'Could not skip this track', undefined, true);
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
