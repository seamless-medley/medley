import { getTrackBanner } from "@seamless-medley/core";
import { bold, quote } from "discord.js";
import { CreateTrackMessageOptionsEx, getEmbedDataForTrack, TrackMessageCreator } from "./base";
import { createCoverImageAttachment } from "../../helpers/message";

export class Simple extends TrackMessageCreator {
  name = "simple";

  protected async doCreate(options: CreateTrackMessageOptionsEx) {
    const { station, embed, track } = options;

    embed.setAuthor({
      name: station.name,
      url: station.url,
      iconURL: station.iconURL
    });

    const data = getEmbedDataForTrack(track, ['artist']);
    const banner = getTrackBanner(track);
    const cover = await createCoverImageAttachment(track, `track-message-${this.automaton.id}`);

    const desc = [
      quote(banner),
      quote(`${bold('Collection')}: ${data.collection}`)
    ].join('\n');

    embed.setDescription(desc);

    if (cover) {
      embed.setThumbnail(cover?.url);
    }

    return {
      ...options,
      embed,
      cover
    };
  }
}
