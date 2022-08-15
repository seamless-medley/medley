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

export type TrackDocument = {
  id: string;
  path: string;
  artist?: string;
  title?: string;
}

export type TrackDocumentFields = keyof TrackDocument;

interface Methods {
  add(id: string, track: TrackDocument): void;
  removeAll(id: string, tracks: TrackDocument[]): void;
  search(id: string, query: Query, searchOptions?: SearchOptions): SearchResult[];
  autoSuggest(id: string, queryString: string, searchOptions?: SearchOptions): Suggestion[];
}

function documentOf(track: BoomBoxTrack): TrackDocument {
  return {
    id: track.id,
    path: track.path,
    artist: track.extra?.tags?.artist,
    title: track.extra?.tags?.title
  }
}

export class SearchEngine extends WorkerPoolAdapter<Methods> {
  private static counter = 0;

  private id = (SearchEngine.counter++).toString(36);

  constructor() {
    super(__dirname + '/search_worker.js', {
      minWorkers: 1,
      maxWorkers: 1
    })
  }

  async add(track: BoomBoxTrack) {
    return this.exec('add', this.id, documentOf(track));
  }

  async removeAll(tracks: BoomBoxTrack[]) {
    await this.exec('removeAll', this.id, tracks.map(documentOf));
  }

  async search(query: Query, searchOptions?: SearchOptions) {
    return this.exec('search', this.id, query, searchOptions);
  }

  async autoSuggest(queryString: string, searchOptions?: SearchOptions) {
    return this.exec('autoSuggest', this.id, queryString, searchOptions);
  }
}
