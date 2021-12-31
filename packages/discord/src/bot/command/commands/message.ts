import { CommandInteraction } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'message',
  description: 'Set channel for messages',
  options: [
    {
      type: OptionType.Channel,
      name: 'channel',
      description: 'Channel to send message to',
      required: true
    }
  ]
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automation) => async (interaction) => {
  const state = automation.getGuildState(interaction.guildId);
  if (state) {
    const channel = interaction.options.getChannel('channel');

    if (!channel) {
      return;
    }

    state.textChannelId = channel.id;
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}


export default descriptor;