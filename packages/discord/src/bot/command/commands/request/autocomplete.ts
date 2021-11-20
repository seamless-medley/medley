import { ApplicationCommandOptionChoice, AutocompleteInteraction } from "discord.js";
import _ from "lodash";
import { InteractionHandlerFactory } from "../../type";

export const createAutocompleteHandler: InteractionHandlerFactory<AutocompleteInteraction> = (automaton) => async (interaction) => {
  const { name, value } = interaction.options.getFocused(true);

  // TODO: nestedBy and nestedTerm
  const completions = value ? _(automaton.dj.autoSuggest(`${value}`, ['artist', 'title'].includes(name) ? name : undefined))
    .take(25)
    .map<ApplicationCommandOptionChoice>(s => ({ name: s, value: s }))
    .value()
    : []

  // TODO: return some suggestion if query is empty, from search history?, request history?

  interaction.respond(completions);
}
