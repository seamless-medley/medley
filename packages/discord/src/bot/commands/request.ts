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
    },
    {
      type: OptionType.String,
      name: 'artist',
      description: 'Artist name',
      autocomplete: true
    },
    {
      type: OptionType.String,
      name: 'title',
      description: 'Song title',
      autocomplete: true
    }
  ]
}

export default request;