import { Query, SearchOptions as MiniSearchOptions, SearchResult, Suggestion } from 'minisearch';
import type { OmitIndexSignature } from 'type-fest';
import { BoomBoxTrack, extractArtists, getArtists } from '../playout';
import { WorkerPoolAdapter } from '../worker_pool_adapter';

export type { Query, SearchResult };

export type SearchOptions = Omit<MiniSearchOptions, 'filter' | 'boostDocument' | 'prefix' | 'fuzzy' | 'tokenize' | 'processTerm'> & {
  prefix?: boolean;
  fuzzy?: boolean | number;
  narrow?: {
    term: string;
    by: string;
  };
}

export type SearchQueryField = 'artist' | 'title';

export type SearchQueryKey = SearchQueryField | 'query';

export type SearchQuery = Partial<Record<SearchQueryKey, string>>;

export type TrackDocument = {
  /**
   * This is the document id, it is formatted as `${trackId}:${tokenized_artist}`
   * The artist tag is tokenized by `/` or `;` or `,` characters
   */
  id: string;

  title?: string;

  artist?: string;

  albumArtist?: string;

  originalArtist?: string;
}

export type TrackDocumentResult = Omit<OmitIndexSignature<SearchResult> & TrackDocument, 'id'> & {
  trackId: string;
};

export type TrackDocumentFields = keyof TrackDocument;

interface Methods {
  add(tracks: TrackDocument[]): void;
  removeAll(tracks: TrackDocument[]): void;
  search(query: Query, searchOptions?: SearchOptions): TrackDocumentResult[];
  autoSuggest(queryString: string, searchOptions?: SearchOptions): Suggestion[];
}

function documentsOf(track: BoomBoxTrack): TrackDocument[] {
  const { id, extra } = track;

  const group = extra ? getArtists(extra) : undefined;

  const artists = group?.artist ? extractArtists(group.artist) : [];

  if (artists.length < 1) {
    artists.push('');
  }

  return artists.map<TrackDocument>(artist => ({
    id: `${id}:${artist}`,
    title: extra?.tags?.title,
    artist,
    albumArtist: group?.albumArtist,
    originalArtist: group?.originalArtist
  }));
}

export class SearchEngine extends WorkerPoolAdapter<Methods> {
  constructor() {
    // Since the search indexes live in memory, we must use single worker per engine
    // Each station will then have its own search engine and indexes
    // It could be more than 1 but that's would increase a lot of memory usage, and indexes in each worker need to be updated simultaneously.
    super(__dirname + '/search_worker.js', {
      minWorkers: 1,
      maxWorkers: 1
    });
  }

  async add(track: BoomBoxTrack) {
    return this.exec('add', documentsOf(track));
  }

  async removeAll(tracks: BoomBoxTrack[]) {
    await this.exec('removeAll', tracks.flatMap(documentsOf));
  }

  async search(query: Query, searchOptions?: SearchOptions) {
    return this.exec('search', query, searchOptions);
  }

  async autoSuggest(queryString: string, searchOptions?: SearchOptions) {
    return this.exec('autoSuggest', queryString, searchOptions);
  }
}
