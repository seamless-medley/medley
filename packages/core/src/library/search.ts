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

export type TrackIndex = {
  id: string;
  artist?: string;
  title?: string;
}

interface Methods {
  add(id: string, track: TrackIndex): Promise<void>;
  removeAll(id: string, tracks: TrackIndex[]): Promise<void>;
  search(id: string, query: Query, searchOptions?: SearchOptions): Promise<SearchResult>;
  autoSuggest(id: string, queryString: string, searchOptions?: SearchOptions): Promise<Suggestion[]>;
}

function indexOf(track: BoomBoxTrack): TrackIndex {
  return {
    id: track.id,
    artist: track.metadata?.tags?.artist,
    title: track.metadata?.tags?.title
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
    return this.exec('add', this.id, indexOf(track));
  }

  async removeAll(tracks: BoomBoxTrack[]) {
    await this.exec('removeAll', this.id, tracks.map(indexOf));
  }

  async search(query: Query, searchOptions?: SearchOptions) {
    return this.exec('search', this.id, query, searchOptions);
  }

  async autoSuggest(queryString: string, searchOptions?: SearchOptions) {
    return this.exec('autoSuggest', this.id, queryString, searchOptions);
  }
}