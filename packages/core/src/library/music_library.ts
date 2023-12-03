import { castArray, chain, isString, noop } from 'lodash';
import normalizePath from 'normalize-path';
import { TrackCreator, WatchTrackCollection, TrackCollectionBasicOptions, TrackCollectionEvents } from '../collections';
import { ILogObj, Logger, createLogger } from '../logging';
import { BoomBoxTrack, TrackKind } from '../playout';
import { BaseLibrary } from './library';
import { SearchEngine, Query, TrackDocumentFields } from './search';
import { MetadataHelper } from '../metadata';
import { MusicDb } from './music_db';
import { TrackWithCollectionExtra } from '../track';
import { scanDir } from './scanner';

export type MusicCollectionDescriptor = {
  id: string;
  paths: string[];
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
  #logger: Logger<ILogObj>;

  #searchEngine = new SearchEngine();

  constructor(
    readonly id: string,
    readonly owner: O,
    readonly musicDb: MusicDb
  ) {
    super();

    this.#logger = createLogger({ name: `library/${this.id}` });
  }

  #trackCreator: TrackCreator<MusicTrack<O>> = async (path) => {
    const fromDb = await this.musicDb.findByPath(path);

    if (!fromDb) {
      return;
    }

    const { trackId: id, ...tags } = fromDb;

    return {
      id,
      path,
      musicId: fromDb.isrc,
      extra: {
        kind: TrackKind.Normal,
        tags
      }
    }
  }

  #handleTrackAddition = (tracks: Array<MusicTrack<O>>) => {
    this.#tryIndexTracks(tracks.map(track => ({ track })));
  }

  #tryIndexTracks = (infos: Array<IndexInfo<O>>) => {
    const failures: Array<IndexInfo<O>> = [];

    this.#indexTracks(infos, failures, () => {
      if (failures.length) {
        setTimeout(() => this.#tryIndexTracks(failures), 1000);
      }
    });
  }


  #handleTrackRemoval = (tracks: Array<MusicTrack<O>>) => {
    for (const { id } of tracks) {
      this.musicDb.delete(id);
    }

    this.#searchEngine.removeAll(tracks);
  }

  #handleTrackUpdates = async (tracks: Array<MusicTrack<O>>) => {
    await this.#searchEngine.removeAll(tracks).catch(e => this.#logger.error(e));

    for (const track of tracks) {
      await this.#indexTrack({ track }, true).catch(noop);
    }
  }

  remove(...collections: Array<string | MusicTrackCollection<O>>) {
    for (const c of collections) {
      const collection =  (typeof c === 'string') ? this.get(c) : c;

      if (collection) {
        collection.unwatchAll();
      }
    }

    super.remove(...collections);
  }

  async #indexTracks(infos: Array<IndexInfo<O>>, failures: Array<IndexInfo<O>>, done: () => void) {
    if (infos.length <= 0) {
      done();
      return;
    }

    const [first, ...remainings] = infos;

    try {
      await this.#indexTrack(first);
    }
    catch (e) {
      first.retried ??= 0;
      first.retried++;

      if (first.retried <= 3)  {
        failures.push(first);
      }
    }

    this.#indexTracks(remainings, failures, done);
  }

  async #indexTrack({ track }: IndexInfo<O>, force: boolean = false) {
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
        this.#logger.error('Error while indexing a track: ', (e as any).message);
        throw e;
      }
    }

    try {
      this.#searchEngine.add(track);
    }
    catch (e) {
      this.#logger.error(e);
      throw e;
    }
  }

  async addCollection(descriptor: MusicCollectionDescriptor, onceReady?: () => void): Promise<MusicTrackCollection<O> | undefined> {
    if (this.has(descriptor.id)) {
      return;
    }

    return new Promise(async (resolve) => {
      const { id, description, paths, ...options } = descriptor;

      const extra: MusicLibraryExtra<O> = {
        description,
        owner: this.owner
      }

      const newCollection = new WatchTrackCollection<MusicTrack<O>, MusicLibraryExtra<O>>(
        id, extra,
        {
          ...options,
          trackCreator: this.#trackCreator,
          scanner: scanDir
        }
      );

      newCollection.once('ready', () => {
        newCollection.shuffle();
        onceReady?.();
        resolve(newCollection);
      });

      newCollection.on('tracksAdd', this.#handleTrackAddition);
      newCollection.on('tracksRemove', this.#handleTrackRemoval);
      newCollection.on('tracksUpdate', this.#handleTrackUpdates);

      this.add(newCollection);

      for (const path of paths) {
        newCollection.watch(normalizePath(path));
      }
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

  async search(q: Partial<Record<'artist' | 'title' | 'query', string>>, limit?: number): Promise<Array<MusicTrack<O>>> {
    const { artist, title, query } = q;

    const mainQueries: Array<Query> = [];

    if (artist || title) {
      const titleAndArtistFields: Array<TrackDocumentFields> = [];
      const titleAndArtistValues: Array<Query> = [];

      if (artist) {
        titleAndArtistValues.push({
          queries: ['artist', 'originalArtist', 'albumArtist'].map(artistField => ({
            fields: [artistField], queries: [artist]
          })),
          combineWith: 'OR',
          boost: {
            originalArtist: 0.85,
            albumArtist: 0.8
          }
        });
      }

      if (title) {
        titleAndArtistFields.push('title');
        titleAndArtistValues.push(title);
      }

      mainQueries.push({
        fields: titleAndArtistFields,
        queries: titleAndArtistValues,
        combineWith: 'AND'
      });
    }

    if (query) {
      mainQueries.push(query)
    }

    const result = await this.#searchEngine.search(
      { queries: mainQueries, combineWith: 'OR' },
      { prefix: true, fuzzy: 0.2 }
    );

    const chained = chain(result)
      .sortBy([s => -s.score, 'title'])
      .map(s => this.findTrackById(s.trackId))
      .filter((t): t is MusicTrack<O> => t !== undefined)
      .uniqBy(t => t.path)

    return (limit ? chained.take(limit) : chained).value();
  }

  async autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string): Promise<string[]> {
    if (!q && field && narrowTerm && narrowBy) {
      let tracks: Array<MusicTrack<O>> | undefined;

      if (field === 'title' && narrowBy === 'artist') {
        // Start showing title suggestion for a known artist
        tracks = await this.search({
          artist: narrowTerm
        });
      }

      if (field === 'artist' && narrowBy === 'title') {
        // Start showing artist suggestion for a known title
        tracks = await this.search({
          title: narrowTerm
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

    const result = await this.#searchEngine.autoSuggest(
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
