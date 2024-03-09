export type MMResponse<B> = {
  message: {
    header: {
      status_code: number;
      hint?: string;
    };
    body: B;
  }
}

export type TokenData = {
  user_token: string;
}

export type Track = {
  track_id: number;
  track_mbid: string;
  track_isrc: string;
  commontrack_isrcs: any[];
  track_spotify_id: string;
  commontrack_spotify_ids: any[];
  track_soundcloud_id: number;
  track_xboxmusic_id: string;
  track_name: string;
  track_name_translation_list: any[];
  track_rating: number;
  track_length: number;
  commontrack_id: number;
  instrumental: boolean;
  explicit: number;
  has_lyrics: boolean;
  has_lyrics_crowd: boolean;
  has_subtitles: boolean;
  has_richsync: boolean;
  has_track_structure: number;
  num_favourite: number;
  lyrics_id: number;
  subtitle_id: number;
  album_id: number;
  album_name: string;
  artist_id: number;
  artist_mbid: string;
  artist_name: string;
  album_coverart_100x100: string;
  album_coverart_350x350: string;
  album_coverart_500x500: string;
  album_coverart_800x800: string;
  track_share_url: string;
  track_edit_url: string;
  commontrack_vanity_id: string;
  restricted: number;
  first_release_date: string;
  updated_time: string;
  primary_genres: {
    music_genre_list: ReadonlyArray<{
      music_genre: {
        music_genre_id: number;
        music_genre_parent_id: number,
        music_genre_name: string,
        music_genre_name_extended: string,
        music_genre_vanity: string
      }
    }>
  };
}

export type SearchData = {
  track_list: ReadonlyArray<{
    track: Track;
  }>;
}

export type TrackGet = {
  track: Track;
}

type PrefixKey<P extends string, T> = {
  [K in keyof T as K extends string ? `${P}_${K}` : never]: T[K];
};

export type LyricInfo<P extends string> = PrefixKey<P, {
  id: number;
  body: string;
  language: string;
  language_description: string;
}> & {
  restricted: boolean;
  updated_time: string;
  lyrics_copyright: string;
};


export type RichSync = {
  ts: number; // Absolute line time start
  te: number; // Absolute line time end
  l: ReadonlyArray<{
    c: string; // Character
    o: number; // Time offset from ts
  }>;
  x: string; // Lyrics line
}

export type RichSyncData = {
  richsync_id: number;
  restricted: boolean;
  richsync_body: string; // json string of RichSync[]
  lyrics_copyright: string;
  richssync_language: string;
  richsync_language_description: string;
  updated_time: string;
}
