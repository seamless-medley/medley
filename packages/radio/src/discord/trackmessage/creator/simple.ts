import { getTrackBanner } from "@seamless-medley/core";
import { formatDuration } from "../../command/utils";
import { createCoverImageAttachment, CreateTrackMessageOptionsEx, getEmbedDataForTrack, TrackMessageCreator } from "./base";

export class Simple extends TrackMessageCreator {
  protected async doCreate(options: CreateTrackMessageOptionsEx) {
    const { station, embed, track, playDuration } = options;

    embed.setAuthor({ name: station.name });

    const data = getEmbedDataForTrack(track, ['artist']);
    const banner = getTrackBanner(track);
    const cover = await createCoverImageAttachment(track);

    const desc = [
      `> ${banner}`,
      `> **Collection**: ${data.collection}`
    ].join('\n');

    embed.setDescription(desc);

    if (cover) {
      embed.setThumbnail(cover?.url);
    }

    if (playDuration > 0) {
      // TODO: These could be configurable in station itself
      embed.setFooter({ text: `Duration: ${formatDuration(playDuration) ?? 'N/A'} - [Powered By Medley]` })
    }

    return {
      ...options,
      embed,
      cover
    };
  }
}
