import { OptionType, SubCommandLikeOption } from "./type";

const request: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'request',
  description: 'Request a song',
  options: [
    {
      type: OptionType.String,
      name: 'query',
      description: 'Search term',
      autocomplete: true
    }
  ]
}

export default request;