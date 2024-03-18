import { BoomBoxTrack, MetadataFields } from "@seamless-medley/core";
import { hyperlink } from "discord.js";

export const metadataFields: MetadataFields[] = ['artist', 'album', 'albumArtist', 'originalArtist'];

export const extractSpotifyMetadata = (track: BoomBoxTrack) => (track.extra?.tags?.comments
  .filter(([key]) => key.startsWith('spotify:'))
  .map(([key, value]) => [key.substring(8), value])
  .reduce<Record<string, string>>((o, [key, value]) => {
    o[key] = value;
    return o;
  }, {})
  ?? {}) as Partial<Record<string, string>>;

export const spotifyBaseURL = 'https://open.spotify.com';

export const spotifyMetadataFields = ['track', 'artist', 'album'];

export const spotifyURI = (text: string, type: string, id: string, tooltip?: string) => {
  const url = `${spotifyBaseURL}/${type}/${id}`
  return tooltip ? hyperlink(text, url, tooltip) : hyperlink(text, url);
}

export const spotifySearchLink = (q: string, field?: string) => hyperlink(q, `${spotifyBaseURL}/search/${encodeURIComponent(q)}` + (field ? `/${field}` : ''), 'Search on Spotify');

export const formatSpotifyField = (field: MetadataFields, value: string, id: string | undefined) => {
  if (!spotifyMetadataFields.includes(field)) {
    return value;
  }

  if (id) {
    return spotifyURI(value, field, id, `More about this ${field} on Spotify`);
  }

  const spotifyFieldMap: Partial<Record<MetadataFields, string>> = {
    title: 'tracks',
    artist: 'artists',
    album: 'albums'
  }

  return spotifySearchLink(value, spotifyFieldMap[field]);
}
