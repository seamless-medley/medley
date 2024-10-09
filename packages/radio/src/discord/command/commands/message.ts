import { ChatInputCommandInteraction } from "discord.js";
import { AutomatonCommandError, ChannelType, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { canSendMessageTo, guildIdGuard, reply } from "../utils";
import { isChannelSuitableForTrackMessage } from "../../trackmessage";
import { AutomatonAccess } from "../../automaton";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'message',
  description: 'Set channel for messages',
  options: [
    {
      type: OptionType.Channel,
      channel_types: [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice],
      name: 'channel',
      description: 'Channel to send message to',
      required: true
    }
  ]
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const guildId = guildIdGuard(interaction);

  const state = automaton.getGuildState(guildId);

  const access = await automaton.getAccessFor(interaction);

  if (access < AutomatonAccess.Administrator) {
    throw new AutomatonCommandError(automaton, 'Insufficient permissions');
  }

  if (state) {
    const channel = interaction.options.getChannel('channel');

    if (!channel) {
      return;
    }

    const guildChannel = interaction.guild?.channels?.cache?.get(channel.id);

    if (!guildChannel || !isChannelSuitableForTrackMessage(guildChannel) || !canSendMessageTo(guildChannel)) {
      reply(interaction, {
        content: `Message could not be sent to channel ${channel.toString()}`,
        ephemeral: true
      });
      return;
    }

    state.textChannelId = channel.id;

    reply(interaction, {
      content: `OK, Messages will be posted in ${channel.toString()}`,
      ephemeral: true
    });
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}


export default descriptor;
