import { isRequestTrack } from "@seamless-medley/core";
import { ButtonInteraction, CommandInteraction, Permissions } from "discord.js";
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
    Permissions.FLAGS.MANAGE_CHANNELS,
    Permissions.FLAGS.MANAGE_GUILD,
    Permissions.FLAGS.MOVE_MEMBERS
  ]);

  const { trackPlay } = station;

  if (trackPlay && isRequestTrack(trackPlay.track)) {
    const { requestedBy } = trackPlay.track;

    if (!automaton.owners.includes(interaction.user.id) && !requestedBy.includes(interaction.user.id)) {
      const mentions = requestedBy.map(id =>  `<@${id}>`).join(' ');
      await reply(interaction, `<@${interaction.user.id}> Could not skip this track, it was requested by ${mentions}`);
      return;
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