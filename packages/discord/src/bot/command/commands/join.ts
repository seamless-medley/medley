import { CommandInteraction, MessageEmbed, Permissions } from "discord.js";
import { ChannelType, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, permissionGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'join',
  description: 'Join a voice channel',
  options: [
    {
      type: OptionType.Channel,
      name: 'channel',
      description: 'Channel name to join',
      channel_types: [ChannelType.GuildVoice],
      required: true
    }
  ]
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = ({ dj, client }) => async (interaction) => {
  permissionGuard(interaction.memberPermissions, [
    Permissions.FLAGS.MANAGE_CHANNELS,
    Permissions.FLAGS.MANAGE_GUILD
  ]);

  const channel = interaction.options.getChannel('channel');

  if (!channel) {
    return;
  }

  const channelToJoin = client.channels.cache.get(channel.id);

  if (!channelToJoin?.isVoice()) {
    return;
  }

  await reply(interaction, `Joining ${channelToJoin}`);

  try {
    await dj.join(channelToJoin);

    reply(interaction, {
      content: null,
      embeds: [
        new MessageEmbed()
          .setColor('RANDOM')
          .setTitle('Joined')
          .addField('channel', channel?.toString())
      ]
    });
  }
  catch (e) {
    deny(interaction, 'Could not join');
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;