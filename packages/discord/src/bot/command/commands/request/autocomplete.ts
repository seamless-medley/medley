import { ApplicationCommandOptionChoice, AutocompleteInteraction } from "discord.js";
import _ from "lodash";
import { InteractionHandlerFactory } from "../../type";

export const createAutocompleteHandler: InteractionHandlerFactory<AutocompleteInteraction> = (automaton) => async (interaction) => {
  const { name, value } = interaction.options.getFocused(true);

  const forArtistOrTitleField = ['artist', 'title'].includes(name);

  const searchField = forArtistOrTitleField ? name : undefined;
  const narrowBy = forArtistOrTitleField ? (name !== 'artist' ? 'artist' : 'title') : undefined;
  const narrowTerm = narrowBy ? interaction.options.getString(narrowBy) : undefined;

  const completions = _(automaton.station.autoSuggest(`${value}`, searchField, narrowTerm ? narrowBy : undefined, narrowTerm || undefined))
      .take(25)
      .map<ApplicationCommandOptionChoice>(s => ({ name: s, value: s }))
      .value()

  interaction.respond(completions);
}
