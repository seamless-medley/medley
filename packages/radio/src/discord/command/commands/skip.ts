import { isRequestTrack, Requester, StationTrack } from "@seamless-medley/core";
import { ButtonInteraction, CommandInteraction, userMention } from "discord.js";
import { AutomatonAccess, MedleyAutomaton } from "../../automaton";
import { extractRequestersForGuild } from "../../trackmessage/creator/base";
import { ansi } from "../../format/ansi";
import { CommandDescriptor,  InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { declare, deny, guildStationGuard, makeAnsiCodeBlock, reply, warn } from "../utils";
import { reject } from "lodash";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'skip',
  description: 'Skip to the next track'
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => (interaction) => handleSkip(automaton, interaction);

async function handleSkip(automaton: MedleyAutomaton, interaction: CommandInteraction | ButtonInteraction) {
  const { guild, station } = guildStationGuard(automaton, interaction);

  const state = automaton.getGuildState(guild.id);

  if (!state) {
    deny(interaction, 'No station linked');
    return;
  }

  const { trackPlay } = station;

  if (!trackPlay || !station.playing || station.paused) {
    deny(interaction, 'Not currently playing');
    return;
  }

  async function doSkip() {
    const result = automaton.skipCurrentSong(interaction.guildId!);

    if (result === true) {
      await declare(interaction,
        makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, {{blue}}Skipping to the next track`),
        { mention: { type: 'user', subject: interaction.user.id }}
      );
      return;
    }

    await warn(interaction, 'Track skipping has been denied');
  }

  const access = await automaton.getAccessFor(interaction);

  if (access === AutomatonAccess.Owner) {
    // Always allow owners
    doSkip();
    return;
  }

  const { track } = trackPlay;

  if (!isRequestTrack<StationTrack, Requester>(track)) {
    // Normal user cannot skip normal track
    if (access < AutomatonAccess.DJ) {
      await deny(interaction,
        'You are not allowed to do that',
        { mention: { type: 'user', subject: interaction.user.id }}
      );

      return;
    }

    // Allow
    doSkip();
    return;
  }

  // Reaching here means, not an owner and the track is a request track

  const { requestedBy } = track;

  const isRequester = requestedBy.some(r => r.requesterId === interaction.user.id);
  const otherRequesters = reject(requestedBy, r => r.requesterId === interaction.user.id);

  if (isRequester && otherRequesters.length === 0) {
    // This is the solo requester, allow
    doSkip();
    return;
  }

  // Someone else has (also) requested for this track
  const discordRequesters = extractRequestersForGuild(guild.id, otherRequesters);
  const mentions = discordRequesters.length > 0 ? discordRequesters.map(id => userMention(id)).join(' ') : '`Someone else`';
  await reply(interaction, `${userMention(interaction.user.id)} Could not skip this track, it was requested by ${mentions}`);
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
