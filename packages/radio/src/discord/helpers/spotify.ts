import { BoomBoxTrack, MetadataFields, extractCommentMetadata } from "@seamless-medley/core";
import axios from "axios";
import { hyperlink } from "discord.js";
import { chain } from "lodash";
import { parse } from 'node-html-parser';

export const extractSpotifyMetadata = (track: BoomBoxTrack) => extractCommentMetadata(track, 'spotify:');

const spotifyBaseURL = 'https://open.spotify.com';

export const spotifyMetadataFields = ['track', 'artist', 'album'];

export const spotifyURI = (type: string, id: string) => `${spotifyBaseURL}/${type}/${id}`;

export const spotifyLink = (text: string, type: string, id: string, tooltip?: string) => {
  const url = spotifyURI(type, id);
  return tooltip ? hyperlink(text, url, tooltip) : hyperlink(text, url);
}

export const spotifySearchLink = (q: string, field?: string) => hyperlink(q, `${spotifyBaseURL}/search/${encodeURIComponent(q)}` + (field ? `/${field}` : ''), 'Search on Spotify');

export const formatSpotifyField = (field: MetadataFields, text: string, id: string | undefined) => {
  const spotifyFieldMap: Partial<Record<MetadataFields, string>> = {
    title: 'track',
    artist: 'artist',
    album: 'album'
  }

  const spotifyField = spotifyFieldMap[field];

  if (!spotifyField) {
    return text;
  }

  if (id) {
    return spotifyLink(text, spotifyField, id, `More about this ${spotifyField} on Spotify`);
  }

  return spotifySearchLink(text, `${spotifyField}s`);
}

export const extractSpotifyUrl = (s: string, limit?: number) => {
  const c = chain(s.match(/(https:\/\/open.spotify.com\/[^\s]+)/ig))
    .map((h) => {
      const u = new URL(h);
      u.search = '';
      return u;
    })
    .uniqBy(u => u.href)
    .map(url => ({ url, paths: url.pathname.substring(1).split('/') as [type: string, id: string] }))
    .filter(({ paths: [type, id] }) => Boolean(type) && Boolean(id) && ['track', 'artist'].includes(type));

  return ((limit ?? 0) > 0 ? c.take(limit) : c).value();
}

type SpotifyTrackInfo = {
  type: 'track';
  title?: string;
  artist?: string;
  artist_url?: string;
  image?: string;
}

type SpotifyArtistInfo = {
  type: 'artist';
  artist?: string;
  image?: string;
}

type SpotifyUserInfo = {
  type: 'user';
  name?: string;
  image?: string;
}

type SpotifyAlbumInfo = {
  type: 'album';
  album?: string;
  image?: string;
  tracks: string[];
}

type SpotifyPlaylistInfo = {
  type: 'playlist';
  name?: string;
  image?: string;
  tracks: string[];
}

type SpotifyInfo = SpotifyTrackInfo | SpotifyArtistInfo | SpotifyUserInfo | SpotifyAlbumInfo | SpotifyPlaylistInfo;

const cache = new Map<string, Promise<SpotifyInfo | undefined>>;

export async function fetchSpotifyInfo(url: string, expectedType?: SpotifyInfo['type']): Promise<SpotifyInfo | undefined> {
  if (cache.has(url)) {
    return cache.get(url)!;
  }

  const promise = internal_fetchSpotifyInfo(url, expectedType);

  cache.set(url, promise);

  promise.finally(() => {
    cache.delete(url);
  });

  return promise;
}

async function internal_fetchSpotifyInfo(url: string, expectedType?: SpotifyInfo['type']): Promise<SpotifyInfo | undefined> {
  const res = await axios.get(url, { timeout: 5000 }).catch(() => false as const);

  if (res === false || res.status !== 200) {
    return;
  }

  const parsed = parse(res.data);
  if (!parsed) {
    return;
  }

  const get = (name: string) => {
    const el = parsed.querySelector(`head meta[property='${name}'], head meta[name='${name}']`);
    return el?.attributes.content;
  }

  const type = ((t) => {
    switch (t) {
      case 'profile':
        return url.includes('artist') ? 'artist' : 'user';
      case 'music.song':
        return 'track';
      case 'music.album':
        return 'album';
      case 'music.playlist':
        return 'playlist';
    }
  })(get('og:type')?.toLowerCase())

  if (expectedType && type !== expectedType) {
    return;
  }

  const getSongList = () => parsed.querySelectorAll(`head meta[name='music:song']`)
    .map(el => el.attributes.content)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)

  switch (type) {
    case 'artist':
      return {
          type,
          artist: get('og:title'),
          image: get('og:image')
        }

    case 'user':
      return {
        type,
        name: get('og:title'),
        image: get('og:image')
      }

    case 'track':
      return {
        type: 'track',
        title: get('og:title'),
        artist: get('music:musician_description'),
        artist_url: get('music:musician'),
        image: get('og:image')
      }

    case 'album':
      return {
        type,
        album: get('og:title'),
        image: get('og:image'),
        tracks: getSongList()
      }

    case 'playlist':
      return {
        type,
        name: get('og:title'),
        image: get('og:image'),
        tracks: getSongList()
      }
  }
}
