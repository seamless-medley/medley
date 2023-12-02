import { CommandDescriptor, OptionType, SubCommandLikeOption } from "../../type";
import { createCommandHandler } from './main';
import { createAutocompleteHandler } from './autocomplete';

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'request',
  description: 'Request a song or view request list',
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
    },
    {
      type: OptionType.Boolean,
      name: 'no-sweep',
      description: 'Disable sweeping while transiting into a new request session'
    }
  ]
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createAutocompleteHandler
}

export default descriptor;
