import _, { castArray, noop } from 'lodash';
import normalizePath from 'normalize-path';
import { TrackActuator, TrackCollectionOptions, WatchTrackCollection } from '../collections';
import { createLogger } from '../logging';
import { MetadataCache } from '../cache';
import { BoomBoxTrack, TrackKind } from '../playout';
import { BaseLibrary } from './library';
import { SearchEngine, Query, TrackDocumentFields } from './search';
import { MetadataHelper } from '../metadata';
import { Metadata } from '@seamless-medley/medley';
import { MusicIdentifierCache } from '../cache/musicid';
import { MusicIdendifier } from '../track';

export type MusicLibraryDescriptor = {
  id: string;
  path: string;
  description?: string;
} & Pick<TrackCollectionOptions<any>, 'reshuffleEvery' | 'newTracksAddingMode'>;

export type MusicLibraryExtra<O> = {
  descriptor: MusicLibraryDescriptor;
  owner: O;
}

export class MusicLibrary<O> extends BaseLibrary<WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>> {
  private logger = createLogger({
    name: `library/${this.id}`
  });

  private searchEngine = new SearchEngine();

  private collectionPaths = new Map<string, string>();

  constructor(readonly id: string, readonly owner: O, readonly metadataCache: MetadataCache, readonly musicIdentifierCache: MusicIdentifierCache) {
    super();
  }

  private trackActuator: TrackActuator<Metadata> = {
    lookup: (path: string) => this.musicIdentifierCache.get(path),

    actuate: (path: string) => helper.metadata(path),

    generateMusicId: async (path: string, metadata?: Metadata) => metadata?.isrc,

    saveIdentifier: async (path: string, identifier: MusicIdendifier) => {
      this.musicIdentifierCache?.set(path, identifier);
    },

    saveIntermediate: async (path: string, identifier: MusicIdendifier, metadata: Metadata) => {
      this.metadataCache?.persist(identifier, metadata);
    }
  }

  private handleTrackRemoval = (tracks: BoomBoxTrack[]) => {
    if (this.musicIdentifierCache) {
      for (const { path } of tracks) {
        this.musicIdentifierCache.del(path);
      }
    }

    this.searchEngine.removeAll(tracks);
  }

  remove(...collections: (string | WatchTrackCollection<BoomBoxTrack>)[]) {
    for (let col of collections) {
      const collection =  (typeof col === 'string') ? this.get(col) : col;

      if (collection) {
        collection.unwatchAll();
        this.collectionPaths.delete(collection.id);
      }
    }

    super.remove(...collections);
  }


  private async indexTracks(collection: WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>, tracks: BoomBoxTrack[], done: () => void) {
    if (tracks.length <= 0) {
      done();
      return;
    }

    const [track, ...remainings] = tracks;

    if (!track.extra?.tags) {
      await helper.fetchMetadata(track, this.metadataCache)
        .then(async ({ metadata: tags }) => {
          track.extra = {
            tags,
            kind: TrackKind.Normal
          };

          this.searchEngine.add(track);
        })
        .catch(e => this.logger.error(e));
    }

    setTimeout(() => this.indexTracks(collection, remainings, done), 0);
  }

  addCollection(descriptor: MusicLibraryDescriptor, onceReady?: () => void): Promise<WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>> {
    return new Promise((resolve) => {
      const { id } = descriptor;
      const path = normalizePath(descriptor.path);

      const newCollection = new WatchTrackCollection<BoomBoxTrack, MusicLibraryExtra<O>>(
        id,
        {
          newTracksAddingMode: descriptor.newTracksAddingMode,
          reshuffleEvery: descriptor.reshuffleEvery,
          trackActuator: this.trackActuator
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

      newCollection.on('tracksAdd', (tracks: BoomBoxTrack[]) => {
        this.indexTracks(newCollection, tracks, noop);
      });


      ////////////////////////////////////////////////////////

      const existing = this.get(id);

      if (!existing) {
        newCollection.on('tracksRemove', this.handleTrackRemoval);
      } else {
        const existingPath = this.collectionPaths.get(id)!;

        // same collection id, but different path
        if (existingPath !== path) {
          // Unwatch old path
          existing.unwatchAll();
          // Detach event handler
          existing.off('tracksRemove', this.handleTrackRemoval);
        }
      }

      this.add(newCollection);
      this.collectionPaths.set(id, path);

      return newCollection.watch(`${path}/**/*`);
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

  /**
   * @deprecated
   */
  private async buildCache(progressCallback?: (progress: number, outOf: number) => any): Promise<number> {
    return new Promise((resolve) => {
      const cache = this.metadataCache;
      if (!cache) {
        resolve(0);
        return;
      }

      progressCallback?.(-1, -1);

      let allTracks: BoomBoxTrack[] = [];

      for (const collection of this) {
        allTracks = allTracks.concat(collection.all());
      }

      const total = allTracks.length;
      progressCallback?.(0, total);

      const process = (tracks: BoomBoxTrack[]) => {
        if (tracks.length <= 0) {
          progressCallback?.(total, total);
          resolve(total);
          return;
        }

        const [track, ...remainings] = tracks;

        const metadata = track.extra?.tags;

        if (metadata) {
          cache.persist(track, metadata).catch(noop);
        }

        progressCallback?.(total - remainings.length, total);
        setTimeout(() => process(remainings), 0);
      }

      process(allTracks);
    });
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

    console.log('search result', result.length);

    const chain = _(result)
      .sortBy([s => -s.score, 'title'])
      .map(s => this.findTrackById(s.id))
      .filter((t): t is BoomBoxTrack => t !== undefined)
      .uniqBy(t => t.path)

    return (limit ? chain.take(limit) : chain).value();
  }

  async autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string): Promise<string[]> {
    const nt = narrowTerm?.toLowerCase();

    if (!q && field === 'title' && narrowBy === 'artist' && narrowTerm) {
      // Start showing title suggestion for a known artist
      const tracks = await this.search({
        artist: narrowTerm,
        title: null,
        query: null
      });

      return _(tracks).map(t => t.extra?.tags?.title).filter(_.isString).uniq().value();
    }

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
