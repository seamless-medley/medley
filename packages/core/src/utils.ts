import { get, intersection } from "lodash";
import { IAudioMetadata, parseFile as parseMetadataFromFile } from "music-metadata";
import { Promise as NodeID3 } from 'node-id3';

export async function getMusicMetadata(path: string): Promise<IAudioMetadata | undefined> {
  try {
    const result = await parseMetadataFromFile(path);
    const { common, format: { tagTypes = [] }} = result;
    const hasLyrics = common.lyrics?.length === 1;

    if (hasLyrics) {
      return result;
    }

    // No lyrics detcted, or mis-interpreted
    // music-metadata does not map TXXX:LYRICS into the lyrics field

    // Try looking up from ID3v2
    const id3Types = intersection(tagTypes, ['ID3v2.3', 'ID3v2.4']);
    for (const tagType of id3Types) {
      const tags = result.native[tagType];

      const tag = tags.find(t => ['SYLT', 'USLT'].includes(t.id));
      if (tag) {
        const value = get(tag, 'value.text');
        if (typeof value === 'string') {
          result.common.lyrics = [value];
          break;
        }
      }

      const lyricTags = tags.filter(t => t.id === 'TXXX:LYRICS');
      if (lyricTags.length === 1) {
        const { value } = lyricTags[0];
        if (typeof value === 'string') {
          result.common.lyrics = [value];
          break;
        }
      }

      // This is rare: Although, TXXX:LYRICS was found, but somehow music-metadata read it incorrectly, where it tries to split tag value by a slash
      // We will use node-id3 to extract TXXX instead
      const { userDefinedText: customTags } = await NodeID3.read(path, { include: ['TXXX'] });
      const foundTag = customTags?.find(t => t.description === 'LYRICS');

      if (foundTag) {
        result.common.lyrics = [foundTag.value];
      }
    }

    return result;
  }
  catch {

  }
}