import { Query, SearchOptions, SearchResult, Suggestion } from 'minisearch';
import workerpool from 'workerpool';
import { BoomBoxTrack } from '../playout';

export type { Query, SearchResult };

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

export class SearchEngine {
  private static counter = 0;

  private id = (SearchEngine.counter++).toString(36);

  private pool = workerpool.pool(__dirname + '/searchWorker.js', {
    minWorkers: 1,
    maxWorkers: 1
  });

  async add(track: BoomBoxTrack) {
    return this.pool.exec<Methods['add']>('add', [this.id, indexOf(track)]);
  }

  async removeAll(tracks: BoomBoxTrack[]) {
    await this.pool.exec<Methods['removeAll']>('removeAll', [this.id, tracks.map(indexOf)]);
  }

  async search(query: Query, searchOptions?: SearchOptions) {
    return this.pool.exec<Methods['search']>('search', [this.id, query, searchOptions]);
  }

  async autoSuggest(queryString: string, searchOptions?: SearchOptions) {
    return this.pool.exec<Methods['autoSuggest']>('autoSuggest', [this.id, queryString, searchOptions]);
  }
}