import { LyricSource } from "../../playout";

export type LyricProviderName = 'musixmatch';

export type LyricsSearchResult = {
  source: LyricSource;
  lyrics?: string;
}

export interface LyricsSearcher {
  searchLyrics(artist: string, title: string): Promise<LyricsSearchResult | undefined>;
}
