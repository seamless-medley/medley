import { castArray, chain, isString, noop } from 'lodash';
import normalizePath from 'normalize-path';
import { TrackCreator, WatchTrackCollection, TrackCollectionBasicOptions, TrackCollection, TrackCollectionEvents } from '../collections';
import { createLogger } from '../logging';
import { BoomBoxTrack, TrackKind } from '../playout';
import { BaseLibrary } from './library';
import { SearchEngine, Query, TrackDocumentFields } from './search';
import { MetadataHelper } from '../metadata';
import { MusicDb } from './music_db';
import { TrackWithCollectionExtra } from '../track';

export type MusicCollectionDescriptor = {
  id: string;
  path: string;
  description: string;
} & TrackCollectionBasicOptions;

export type MusicLibraryExtra<O> = {
  description: string;
  owner: O;
}

export type MusicTrack<O> = TrackWithCollectionExtra<BoomBoxTrack, MusicLibraryExtra<O>>;

export type MusicTrackCollection<O> = WatchTrackCollection<MusicTrack<O>, MusicLibraryExtra<O>>;

export type MusicTrackCollectionEvents<O> = TrackCollectionEvents<MusicTrack<O>>;

type IndexInfo<O> = {
  track: MusicTrack<O>;
  retried?: number;
}

export class MusicLibrary<O> extends BaseLibrary<MusicTrackCollection<O>> {
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

  private trackCreator: TrackCreator<MusicTrack<O>> = async (path) => {
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

  private handleTrackAddition = (tracks: MusicTrack<O>[]) => {
    this.tryIndexTracks(tracks.map(track => ({ track })));
  }

  private tryIndexTracks = (info: IndexInfo<O>[]) => {
    const failures: IndexInfo<O>[] = [];

    this.indexTracks(info, failures, () => {
      if (failures.length) {
        setTimeout(() => {
          this.tryIndexTracks(failures);
        }, 1000);
      }
    });
  }


  private handleTrackRemoval = (tracks: MusicTrack<O>[]) => {
    for (const { id } of tracks) {
      this.musicDb.delete(id);
    }

    this.searchEngine.removeAll(tracks);
  }

  private handleTrackUpdates = async (tracks: MusicTrack<O>[]) => {
    await this.searchEngine.removeAll(tracks).catch(e => this.logger.error(e));

    for (const track of tracks) {
      await this.indexTrack({ track }, true).catch(noop);
    }
  }

  remove(...collections: (string | MusicTrackCollection<O>)[]) {
    for (const c of collections) {
      const collection =  (typeof c === 'string') ? this.get(c) : c;

      if (collection) {
        collection.unwatchAll();
        this.collectionPaths.delete(collection.id);
      }
    }

    super.remove(...collections);
  }

  private async indexTracks(infos: IndexInfo<O>[], failures: IndexInfo<O>[], done: () => void) {
    if (infos.length <= 0) {
      done();
      return;
    }

    const [first, ...remainings] = infos;

    try {
      await this.indexTrack(first);
    }
    catch (e) {
      first.retried ??= 0;
      first.retried++;

      if (first.retried <= 3)  {
        failures.push(first);
      }
    }

    this.indexTracks(remainings, failures, done);
  }

  private async indexTrack({ track }: IndexInfo<O>, force: boolean = false) {
    if (force || !track.extra?.tags) {
      try {
        await helper.fetchMetadata(track, this.musicDb, force)
          .then(async (result) => {
            track.musicId = result.metadata.isrc,
            track.extra = {
              ...track.extra,
              tags: result.metadata,
              kind: TrackKind.Normal
            };
          });
      }
      catch (e) {
        this.logger.error('Error while indexing a track: ', (e as any).message);
        throw e;
      }
    }

    try {
      this.searchEngine.add(track);
    }
    catch (e) {
      this.logger.error(e);
      throw e;
    }
  }

  async addCollection(descriptor: MusicCollectionDescriptor, onceReady?: () => void): Promise<MusicTrackCollection<O> | undefined> {
    if (this.has(descriptor.id)) {
      return;
    }

    return new Promise(async (resolve) => {
      const { id, description, path, ...options } = descriptor;

      const extra: MusicLibraryExtra<O> = {
        description,
        owner: this.owner
      }

      const newCollection = new WatchTrackCollection<MusicTrack<O>, MusicLibraryExtra<O>>(
        id, extra,
        {
          ...options,
          trackCreator: this.trackCreator
        }
      );

      newCollection.once('ready', () => {
        newCollection.shuffle();
        onceReady?.();
        resolve(newCollection);
      });

      newCollection.on('tracksAdd', this.handleTrackAddition);
      newCollection.on('tracksRemove', this.handleTrackRemoval);
      newCollection.on('tracksUpdate', this.handleTrackUpdates);

      const normalizedPath = normalizePath(path);

      this.add(newCollection);
      this.collectionPaths.set(id, normalizedPath);
      newCollection.watch(normalizedPath);
    });
  }

  get size(): number {
    return super.size;
  }

  all() {
    return super.all();
  }

  has(id: string): boolean {
    return super.has(id);
  }

  get(id: string): MusicTrackCollection<O> | undefined {
    return super.get(id);
  }

  findTrackById(id: MusicTrack<O>['id']) {
    for (const collection of this) {
      const track = collection.fromId(id);
      if (track) {
        return track;
      }
    }
  }

  async search(q: Record<'artist' | 'title' | 'query', string | null>, limit?: number): Promise<MusicTrack<O>[]> {
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
      .filter((t): t is MusicTrack<O> => t !== undefined)
      .uniqBy(t => t.path)

    return (limit ? chained.take(limit) : chained).value();
  }

  async autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string): Promise<string[]> {
    if (!q && field && narrowTerm && narrowBy) {
      let tracks: MusicTrack<O>[] | undefined;

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
