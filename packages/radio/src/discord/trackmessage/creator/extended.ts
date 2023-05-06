import { CreateTrackMessageOptionsEx } from "./base";
import { Normal } from "./normal";

export class Extended extends Normal {
  override async doCreate(options: CreateTrackMessageOptionsEx) {
    const result = await super.doCreate(options);

    const { embed, cover } = result;

    embed.setThumbnail(null);
    embed.setImage(cover?.url || null);

    return result;
  }
}
