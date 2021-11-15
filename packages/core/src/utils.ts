import { chain, get, intersection } from "lodash";
import { IAudioMetadata, ITag, parseFile as parseMetadataFromFile } from "music-metadata";
import { TagType } from "music-metadata/lib/common/GenericTagTypes";
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

const supportedTagTypes = ['ID3v2.3', 'ID3v2.4', 'ID3v2.2', 'vorbis'] as const;
const cueTagNames = ['cue-in', 'cue-out', 'cue_in', 'cue_out'];

function _tagCollection(tag: ITag[], type: TagType) {
  if (type.startsWith('ID3v2')) {
    return chain(tag)
      .filter(({ id }) => id.startsWith('TXXX'))
      .mapKeys(({ id }) => id.substr(5).toLowerCase())
  }

  if (type === 'vorbis') {
    return chain(tag)
      .mapKeys(({ id }) => id.toLowerCase())
  }
}

export type CuePoints = {
  in?: number;
  out?: number;
}

export function getCuePoints(metadata: IAudioMetadata): CuePoints | undefined {
  const { native, format } = metadata;
  const { tagTypes = [] } = format;

  for (const tagType of intersection(supportedTagTypes, tagTypes)) {
    const tag = native[tagType];

    const cues = _tagCollection(tag, tagType)
      ?.pickBy((_, key) => cueTagNames.includes(key))
      .mapValues(tag => Number(tag.value))
      .mapKeys((_, key) => key.substr(4))
      .value();

    if (!cues) {
      return;
    }

    return cues;
  }
}

export const decibelsToGain = (decibels: number): number => decibels > -100 ? Math.pow(10, decibels * 0.05) : 0;

export const gainToDecibels = (gain: number): number => gain > 0 ? Math.max(-100, Math.log10(gain) * 20) : -100;