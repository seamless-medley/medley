import { MetadataFields } from "@seamless-medley/core";
import { hyperlink } from "discord.js";

const spotifyMarkdownLink = (q: string) => hyperlink(q, `https://open.spotify.com/search/${encodeURIComponent(q)}`);

export const formatSpotifyField = (field: MetadataFields, value: string) => spotifySearchFields.includes(field) ? spotifyMarkdownLink(value) : value

export const metadataFields: MetadataFields[] = ['artist', 'album', 'albumArtist', 'originalArtist'];
export const spotifySearchFields: MetadataFields[] = metadataFields;
