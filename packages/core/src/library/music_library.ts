import { castArray, chain, isString, noop } from 'lodash';
import normalizePath from 'normalize-path';
import { TrackCreator, TrackCollectionOptions, WatchTrackCollection } from '../collections';
import { createLogger } from '../logging';
import { BoomBoxTrack, TrackKind } from '../playout';
import { BaseLibrary } from './library';
import { SearchEngine, Query, TrackDocumentFields } from './search';
import { MetadataHelper } from '../metadata';
import { MusicDb } from './music_db';

export type MusicCollectionDescriptor = {
  id: string;
  path: string;
  description?: string;
} & Omit<TrackCollectionOptions<any>, 'trackCreator' | 'trackMapper'>;

export type MusicLibraryExtra<O> = {
  descriptor: MusicCollectionDescriptor;
  owner: O;
}

export class MusicLibrary<O> extends BaseLibrary<WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>> {
  private logger = createLogger({ name: `library/${this.id}` });

  private searchEngine = new SearchEngine();

  private collectionPaths = new Map<string, string>();

  constructor(
    readonly id: string,
    readonly owner: O,
    readonly musicDb: MusicDb
  ) {
    super();
  }

  private trackCreator: TrackCreator<BoomBoxTrack> = async (path) => {
    const fromDb = await this.musicDb.findByPath(path);

    if (!fromDb) {
      return;
    }

    const { trackId: id, isrc: musicId, ...tags } = fromDb;

    return {
      id,
      path,
      musicId,
      extra: {
        kind: TrackKind.Normal,
        tags
      }
    }
  }

  private handleTrackAddition = (tracks: BoomBoxTrack[]) => this.indexTracks(tracks, noop);

  private handleTrackRemoval = (tracks: BoomBoxTrack[]) => {
    for (const { id } of tracks) {
      this.musicDb.delete(id);
    }

    this.searchEngine.removeAll(tracks);
  }

  private handleTrackUpdates = async (tracks: BoomBoxTrack[]) => {
    await this.searchEngine.removeAll(tracks).catch(noop);

    for (const track of tracks) {
      await this.indexTrack(track, true);
    }
  }

  remove(...collections: (string | WatchTrackCollection<BoomBoxTrack>)[]) {
    for (const c of collections) {
      const collection =  (typeof c === 'string') ? this.get(c) : c;

      if (collection) {
        collection.unwatchAll();
        this.collectionPaths.delete(collection.id);
      }
    }

    super.remove(...collections);
  }

  private async indexTracks(tracks: BoomBoxTrack[], done: () => void) {
    if (tracks.length <= 0) {
      done();
      return;
    }

    const [track, ...remainings] = tracks;

    await this.indexTrack(track);
    this.indexTracks(remainings, done);
  }

  private async indexTrack(track: BoomBoxTrack, force: boolean = false) {
    if (force || !track.extra?.tags) {
      await helper.fetchMetadata(track, this.musicDb, force)
        .then(async (result) => {
          track.musicId = result.metadata.isrc,
          track.extra = {
            ...track.extra,
            tags: result.metadata,
            kind: TrackKind.Normal
          };
        })
        .catch(e => this.logger.error(e));
    }

    this.searchEngine.add(track);
  }

  addCollection(descriptor: MusicCollectionDescriptor, onceReady?: () => void) {
    return new Promise<WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>>(async (resolve) => {
      const { id } = descriptor;
      const path = normalizePath(descriptor.path);

      const newCollection = new WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>(
        id,
        {
          ...descriptor,
          trackCreator: this.trackCreator
        }
      );

      newCollection.extra = {
        descriptor,
        owner: this.owner
      };

      newCollection.once('ready', () => {
        newCollection.shuffle();
        onceReady?.();
        resolve(newCollection);
      });

      ////////////////////////////////////////////////////////

      const existing = this.get(id);

      if (!existing) {
        newCollection.on('tracksAdd', this.handleTrackAddition);
        newCollection.on('tracksRemove', this.handleTrackRemoval);
        newCollection.on('tracksUpdate', this.handleTrackUpdates);
      } else {
        const existingPath = this.collectionPaths.get(id)!;

        // same collection id, but different path
        if (existingPath !== path) {
          // Unwatch old path
          existing.unwatchAll();

          // Detach event handlers
          existing.off('tracksAdd', this.handleTrackAddition);
          existing.off('tracksRemove', this.handleTrackRemoval);
          existing.off('tracksUpdate', this.handleTrackUpdates);
        }
      }

      this.add(newCollection);
      this.collectionPaths.set(id, path);

      newCollection.watch(path);
    });
  }

  get size(): number {
    return super.size;
  }

  has(id: string): boolean {
    return super.has(id);
  }

  get(id: string): WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>> | undefined {
    return super.get(id);
  }

  findTrackById(id: BoomBoxTrack['id']) {
    for (const collection of this) {
      const track = collection.fromId(id);
      if (track) {
        return track;
      }
    }
  }

  async search(q: Record<'artist' | 'title' | 'query', string | null>, limit?: number): Promise<BoomBoxTrack[]> {
    const { artist, title, query } = q;

    const queries: Query[] = [];

    if (artist || title) {
      const fields: TrackDocumentFields[] = [];
      const values: string[] = [];

      if (artist) {
        fields.push('artist');
        values.push(artist);
      }

      if (title) {
        fields.push('title');
        values.push(title);
      }

      queries.push({
        fields,
        queries: values,
        combineWith: 'AND'
      })
    }

    if (query) {
      queries.push(query)
    }

    const result = await this.searchEngine.search({ queries, combineWith: 'OR' }, { prefix: true, fuzzy: 0.2 });

    const chained = chain(result)
      .sortBy([s => -s.score, 'title'])
      .map(s => this.findTrackById(s.id))
      .filter((t): t is BoomBoxTrack => t !== undefined)
      .uniqBy(t => t.path)

    return (limit ? chained.take(limit) : chained).value();
  }

  async autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string): Promise<string[]> {
    if (!q && field && narrowTerm && narrowBy) {
      let tracks: BoomBoxTrack[] | undefined;

      if (field === 'title' && narrowBy === 'artist') {
        // Start showing title suggestion for a known artist
        tracks = await this.search({
          artist: narrowTerm,
          title: null,
          query: null
        });
      }

      if (field === 'artist' && narrowBy === 'title') {
        // Start showing artist suggestion for a known title
        tracks = await this.search({
          title: narrowTerm,
          artist: null,
          query: null
        });
      }

      if (tracks) {
        return chain(tracks)
          .map(t => (t.extra?.tags as any)?.[field])
          .filter(isString)
          .uniq()
          .value();
      }
    }

    const nt = narrowTerm?.toLowerCase();
    const narrow = (narrowBy && nt)
      ? ({
        by: narrowBy,
        term: nt
      })
      : undefined;

    const result = await this.searchEngine.autoSuggest(
      q,
      {
        fields: field ? castArray(field) : undefined,
        prefix: true,
        fuzzy: 0.3,
        narrow,
      }
    );

    return result.map(s => s.suggestion);
  }
}

const helper = new MetadataHelper();
