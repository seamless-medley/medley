import { MetadataHelper, StationTrack } from "../../core";
import { AttachmentBuilder } from "discord.js";
import mime from 'mime-types';

export type CoverImageAttachment = {
  builder: AttachmentBuilder;
  url: string;
}

export async function createCoverImageAttachment({ extra, path }: StationTrack, helper: MetadataHelper): Promise<CoverImageAttachment | undefined> {
  const coverAndLyrics = await (extra?.maybeCoverAndLyrics ?? helper.coverAndLyrics(path));

  if (!coverAndLyrics) {
    return;
  }

  const { cover, coverMimeType } = coverAndLyrics;

  if (!cover.length) {
    return;
  }

  const ext = mime.extension(coverMimeType);
  const builder = new AttachmentBuilder(cover, { name: `cover.${ext}` });
  return {
    builder,
    url: `attachment://${builder.name}`
  }
}
