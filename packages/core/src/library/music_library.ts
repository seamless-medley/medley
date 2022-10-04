import _, { castArray, noop } from 'lodash';
import normalizePath from 'normalize-path';
import { TrackCreator, TrackCollectionOptions, WatchTrackCollection } from '../collections';
import { createLogger } from '../logging';
import { BoomBoxTrack, TrackKind } from '../playout';
import { BaseLibrary } from './library';
import { SearchEngine, Query, TrackDocumentFields } from './search';
import { MetadataHelper } from '../metadata';
import { MusicDb } from './music_db';

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

  private handleTrackRemoval = (tracks: BoomBoxTrack[]) => {
    for (const { id } of tracks) {
      this.musicDb.delete(id);
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

  private async indexTracks(tracks: BoomBoxTrack[], done: () => void) {
    if (tracks.length <= 0) {
      done();
      return;
    }

    const [track, ...remainings] = tracks;

    this.indexTrack(track).then(() => this.indexTracks(remainings, done));
  }

  private async indexTrack(track: BoomBoxTrack, force: boolean = false) {
    if (force || !track.extra?.tags) {
      await helper.fetchMetadata(track, this.musicDb, force)
        .then(async ({ metadata: tags }) => {
          track.musicId = tags.isrc,
          track.extra = {
            tags,
            kind: TrackKind.Normal
          };
        })
        .catch(e => this.logger.error(e));
    }

    this.searchEngine.add(track);
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

      newCollection.on('tracksAdd', (tracks: BoomBoxTrack[]) => this.indexTracks(tracks, noop));

      newCollection.on('tracksUpdate', async (tracks: BoomBoxTrack[]) => {
        await this.searchEngine.removeAll(tracks);

        for (const track of tracks) {
          await this.indexTrack(track, true);
        }
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

    const chain = _(result)
      .sortBy([s => -s.score, 'title'])
      .map(s => this.findTrackById(s.id))
      .filter((t): t is BoomBoxTrack => t !== undefined)
      .uniqBy(t => t.path)

    return (limit ? chain.take(limit) : chain).value();
  }

  async autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string): Promise<string[]> {
    if (!q && field === 'title' && narrowBy === 'artist' && narrowTerm) {
      // Start showing title suggestion for a known artist
      const tracks = await this.search({
        artist: narrowTerm,
        title: null,
        query: null
      });

      return _(tracks).map(t => t.extra?.tags?.title).filter(_.isString).uniq().value();
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
