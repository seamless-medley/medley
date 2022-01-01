import { getTrackBanner } from "@seamless-medley/core";
import { SelectMenuInteraction } from "discord.js";
import { MedleyAutomaton } from "../../../automaton";
import { HighlightTextType, makeHighlightedMessage, makeRequestPreview } from "../../utils";

export const handleSelectMenu = async (automaton: MedleyAutomaton, interaction: SelectMenuInteraction) => {
  const { values, member } = interaction;

  if (values.length && member) {
    const trackId = values[0];
    if (trackId) {
      const ok = await automaton.dj.request(trackId, member.user.id);

      if (ok === false || ok.index < 0) {
        await interaction.update({
          content: makeHighlightedMessage('Track could not be requested for some reasons', HighlightTextType.Red),
          components: []
        });
        return;
      }

      const preview = await makeRequestPreview(automaton, ok.index, ok.index);
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