import { SearchQueryField } from "@seamless-medley/core";
import { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from "discord.js";
import { chain } from "lodash";
import { InteractionHandlerFactory } from "../../type";

export const createAutocompleteHandler: InteractionHandlerFactory<AutocompleteInteraction> = (automaton) => async (interaction) => {
  const { guildId } = interaction;
  const station = guildId ? automaton.getTunedStation(guildId) : undefined;

  if (!station) {
    interaction.respond([]);
    return;
  }

  const { name, value } = interaction.options.getFocused(true);

  const forArtistOrTitleField = ['artist', 'title'].includes(name);

  const searchField = forArtistOrTitleField ? name as SearchQueryField : undefined;
  const narrowBy = forArtistOrTitleField ? (name !== 'artist' ? 'artist' : 'title') : undefined;
  const narrowTerm = narrowBy ? interaction.options.getString(narrowBy) : undefined;

  const suggestions = await station.autoSuggest(`${value}`, searchField, narrowTerm ? narrowBy : undefined, narrowTerm || undefined);

  const completions = chain(suggestions)
      .take(25)
      .map<ApplicationCommandOptionChoiceData>(s => ({ name: s, value: s }))
      .value()

  interaction.respond(completions);
}
