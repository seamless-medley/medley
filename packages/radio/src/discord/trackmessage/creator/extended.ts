import { formatDuration } from "../../command/utils";
import { CreateTrackMessageOptionsEx } from "./base";
import { Normal } from "./normal";

export class Extended extends Normal {
  override async doCreate(options: CreateTrackMessageOptionsEx) {
    const result = await super.doCreate(options);

    const { embed, cover, playDuration } = result;

    const durationFieldIndex = embed.data.fields?.findIndex(f => f.name === 'Duration') ?? -1;
    if (durationFieldIndex > -1) {
      embed.spliceFields(durationFieldIndex, 1);
      embed.setFooter({ text: `🎧 Duration: ${formatDuration(playDuration) ?? 'N/A'}` });
    }

    const collectionFieldIndex = embed.data.fields?.findIndex(f => f.name === 'Collection') ?? -1;
    if (durationFieldIndex > -1) {
      embed.data.fields![collectionFieldIndex].inline = false;
    }

    embed.setThumbnail(null);
    embed.setImage(cover?.url || null);

    return result;
  }
}