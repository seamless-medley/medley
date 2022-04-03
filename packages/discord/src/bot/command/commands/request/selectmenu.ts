import { getTrackBanner } from "@seamless-medley/core";
import { SelectMenuInteraction } from "discord.js";
import { MedleyAutomaton } from "../../../automaton";
import { guildStationGuard, HighlightTextType, makeHighlightedMessage, makeRequestPreview } from "../../utils";

export const handleSelectMenu = async (automaton: MedleyAutomaton, interaction: SelectMenuInteraction) => {
  const { station } = guildStationGuard(automaton, interaction);

  const { values, user } = interaction;

  if (values.length) {
    const [trackId] = values;

    if (trackId) {
      const ok = await station.request(trackId, user.id);

      if (ok === false || ok.index < 0) {
        await interaction.update({
          content: makeHighlightedMessage('Track could not be requested for some reasons', HighlightTextType.Red),
          components: []
        });
        return;
      }

      const preview = await makeRequestPreview(station, ok.index, ok.index);
      await interaction.update({
        content: `Request accepted: \`${getTrackBanner(ok.track)}\``,
        components: []
      });

      if (preview) {
        interaction.followUp({
          content: preview.join('\n')
        })
      }
    }
  }
}