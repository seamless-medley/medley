import { Query, SearchOptions as MiniSearchOptions, SearchResult, Suggestion } from 'minisearch';
import { BoomBoxTrack } from '../playout';
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

export type SearchQuery = Record<SearchQueryKey, string | null>;

export type TrackDocument = {
  id: string;
  artist?: string;
  title?: string;
}

export type TrackDocumentFields = keyof TrackDocument;

interface Methods {
  add(track: TrackDocument): void;
  removeAll(tracks: TrackDocument['id'][]): void;
  search(query: Query, searchOptions?: SearchOptions): SearchResult[];
  autoSuggest(queryString: string, searchOptions?: SearchOptions): Suggestion[];
}

function documentOf(track: BoomBoxTrack): TrackDocument {
  return {
    id: track.id,
    artist: track.extra?.tags?.artist,
    title: track.extra?.tags?.title
  }
}

export class SearchEngine extends WorkerPoolAdapter<Methods> {
  constructor() {
    super(__dirname + '/search_worker.js', {
      minWorkers: 1,
      maxWorkers: 1
    })
  }

  async add(track: BoomBoxTrack) {
    return this.exec('add', documentOf(track));
  }

  async removeAll(tracks: BoomBoxTrack[]) {
    await this.exec('removeAll', tracks.map(t => t.id));
  }

  async search(query: Query, searchOptions?: SearchOptions) {
    return this.exec('search', query, searchOptions);
  }

  async autoSuggest(queryString: string, searchOptions?: SearchOptions) {
    return this.exec('autoSuggest', queryString, searchOptions);
  }
}
