import { ChatInputCommandInteraction, ChannelType as DJSChannelType } from "discord.js";
import { ChannelType, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildIdGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'message',
  description: 'Set channel for messages',
  options: [
    {
      type: OptionType.Channel,
      channel_types: [ChannelType.GuildText],
      name: 'channel',
      description: 'Channel to send message to',
      required: true
    }
  ]
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automation) => async (interaction) => {
  const guildId = guildIdGuard(interaction);

  const state = automation.getGuildState(guildId);

  if (state) {
    const channel = interaction.options.getChannel('channel');

    if (!channel) {
      return;
    }

    const guildChannel = interaction.guild?.channels?.cache?.get(channel.id);

    if (guildChannel?.type !== DJSChannelType.GuildText || !automation.canSendMessageTo(guildChannel)) {
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
