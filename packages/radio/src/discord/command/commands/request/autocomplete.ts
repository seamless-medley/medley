import { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from "discord.js";
import { chain, truncate } from "lodash";
import { InteractionHandlerFactory } from "../../type";
import { SearchQueryField } from "../../../../core";

export const createAutocompleteHandler: InteractionHandlerFactory<AutocompleteInteraction> = (automaton) => async (interaction) => {
  const { guildId } = interaction;
  const station = guildId ? automaton.getGuildState(guildId)?.tunedStation : undefined;

  if (!station) {
    interaction.respond([]);
    return;
  }

  const { name, value } = interaction.options.getFocused(true);

  const searchField = ['artist', 'title'].includes(name) ? name as SearchQueryField : undefined;

  const narrowBy = searchField ? ({
    'artist': 'title',
    'title': 'artist'
  })[searchField] as SearchQueryField : undefined;

  const narrowTerm = narrowBy ? interaction.options.getString(narrowBy) : undefined;

  const suggestions = await station.autoSuggest(`${value}`, searchField, narrowTerm ? narrowBy : undefined, narrowTerm || undefined);

  const completions = chain(suggestions)
      .take(25)
      .map(s => truncate(s, { length: 100 }))
      .map<ApplicationCommandOptionChoiceData>(s => ({ name: s, value: s }))
      .value()

  return interaction.respond(completions);
}
