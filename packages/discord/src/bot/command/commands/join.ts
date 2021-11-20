import { ChannelType, OptionType, SubCommandLikeOption } from "../type";

const join: SubCommandLikeOption = {
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

export default join;