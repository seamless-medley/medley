import { BoomBoxTrackPlay, isRequestTrack } from "@medley/core";
import { ButtonInteraction, CommandInteraction, Permissions } from "discord.js";
import { MedleyAutomaton } from "../../automaton";
import { CommandDescriptor,  InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { accept, deny, permissionGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'skip',
  description: 'Skip to the next track'
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> =
  (automaton) => (interaction) => handleSkip(automaton, interaction);


async function handleSkip(automaton: MedleyAutomaton, interaction: CommandInteraction | ButtonInteraction) {
  permissionGuard(interaction.memberPermissions, [
    Permissions.FLAGS.MANAGE_CHANNELS,
    Permissions.FLAGS.MANAGE_GUILD,
    Permissions.FLAGS.MOVE_MEMBERS
  ]);

  const { trackPlay } = automaton.dj;

  if (trackPlay && isRequestTrack(trackPlay.track)) {
    const { requestedBy } = trackPlay.track;

    if (requestedBy && requestedBy !== interaction.user.id) {
      await reply(interaction, `<@${interaction.user.id}> Could not skip this track, it was requested by <@${requestedBy}>`);
      return;
    }
  }

  if (automaton.dj.paused || !automaton.dj.playing) {
    await deny(interaction, 'Not currently playing', `@${interaction.user.id}`);
    return;
  }

  automaton.skipCurrentSong();
  accept(interaction, `OK: Skipping to the next track`, `@${interaction.user.id}`);
}

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, playUuid: string) => {
  if (automaton.dj.trackPlay?.uuid !== playUuid) {
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