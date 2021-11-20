import { ChannelType, OptionType, SubCommandLikeOption } from "./type";

const volume: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'volume',
  description: 'Set volume',
  options: [
    {
      type: OptionType.Number,
      name: 'db',
      description: 'Volume in Decibels',
      min_value: -60,
      max_value: 12,
      required: false
    }
  ]
}

export default volume;