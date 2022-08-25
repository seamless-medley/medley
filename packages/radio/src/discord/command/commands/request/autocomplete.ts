import { SearchQueryField } from "@seamless-medley/core";
import { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from "discord.js";
import _ from "lodash";
import { InteractionHandlerFactory } from "../../type";
import { guildStationGuard } from "../../utils";

export const createAutocompleteHandler: InteractionHandlerFactory<AutocompleteInteraction> = (automaton) => async (interaction) => {
  // FIXME: Don't use guard here, it throws an exception
  const { station } = guildStationGuard(automaton, interaction);

  const { name, value } = interaction.options.getFocused(true);

  const forArtistOrTitleField = ['artist', 'title'].includes(name);

  const searchField = forArtistOrTitleField ? name as SearchQueryField : undefined;
  const narrowBy = forArtistOrTitleField ? (name !== 'artist' ? 'artist' : 'title') : undefined;
  const narrowTerm = narrowBy ? interaction.options.getString(narrowBy) : undefined;

  const suggestions = await station.autoSuggest(`${value}`, searchField, narrowTerm ? narrowBy : undefined, narrowTerm || undefined);

  const completions = _(suggestions)
      .take(25)
      .map<ApplicationCommandOptionChoiceData>(s => ({ name: s, value: s }))
      .value()

  interaction.respond(completions);
}
