import { castArray, chain, isString, noop, partition } from 'lodash';
import normalizePath from 'normalize-path';
import { TrackCreator, WatchTrackCollection, TrackCollectionBasicOptions, TrackCollectionEvents } from '../collections';
import { Logger, createLogger } from '@seamless-medley/logging';
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
  succeeded?: boolean;
}

type Stats = Record<'discovered' | 'indexing' | 'indexed', number>;

export interface MusicLibraryEvents {
  stats(stats: Stats): void;
}

export class MusicLibrary<O> extends BaseLibrary<MusicTrackCollection<O>, MusicLibraryEvents> {
  #logger: Logger;

  #searchEngine = new SearchEngine();

  constructor(
    readonly id: string,
    readonly owner: O,
    readonly musicDb: MusicDb
  ) {
    super();

    this.#logger = createLogger({ name: 'library', id: this.id });
  }

  #stats: Stats = {
    discovered: 0,
    indexing: 0,
    indexed: 0
  }

  private set stats(newStats: Partial<Stats>) {
    this.#stats = {
      ...this.#stats,
      ...newStats
    }

    this.emit('stats', this.#stats);
  }

  get stats() {
    return this.#stats;
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

  #handleTrackAddition = (collection: WatchTrackCollection<MusicTrack<O>, MusicLibraryExtra<O>>) => (tracks: Array<MusicTrack<O>>, chunkIndex: number, totalChunks: number) => {
    this.stats = {
      discovered: this.#stats.discovered + tracks.length
    }

    const infos = tracks.map<IndexInfo<O>>(track => ({ track, succeeded: false }));

    this.#tryIndexTracks(infos, () => {
      const [succeeded, failures] = partition(infos, info => info.succeeded);

      this.#logger.info('%d tracks(s) from collection \'%s\' have been indexed', succeeded.length, collection.extra.description);

      if (failures.length) {
        this.#logger.warn(failures.map(f => f.track.path), 'Could not index');
      }

      if (chunkIndex +1 === totalChunks) {
        this.#logger.info('Done indexing: %s', collection.extra.description);
      }
    });
  }

  #tryIndexTracks = async (infos: Array<IndexInfo<O>>, done: () => void) => {
    this.stats = {
      indexing: this.#stats.indexing + infos.length
    }

    this.#indexTracks(infos, async (retries) => {
      if (retries.length) {
        setTimeout(() => this.#tryIndexTracks(retries, done), 1000);
        return;
      }

      done();
    });
  }

  #handleTrackRemoval = (tracks: Array<MusicTrack<O>>) => {
    for (const { id } of tracks) {
      this.musicDb.delete(id);
    }

    this.#searchEngine.removeAll(tracks);

    this.stats = {
      discovered: this.#stats.discovered - tracks.length,
      indexed: this.#stats.indexed - tracks.length
    }
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

  async #indexTracks(infos: Array<IndexInfo<O>>, done: (failures: Array<IndexInfo<O>>) => void) {
    const failures: Array<IndexInfo<O>> = [];

    await Promise.all(infos.map(info => this.#indexTrack(info)
      .then(() => {
        info.succeeded = true;

        this.stats = {
          indexing: this.#stats.indexing - 1,
          indexed: this.#stats.indexed + 1
        }
      })
      .catch(() => {
        info.retried ??= 0;
        info.retried++;

        this.stats = {
          indexing: this.#stats.indexing - 1
        }

        if (info.retried <= 3) {
          failures.push(info);
        }
      })
    ));

    done(failures);
  }

  async #indexTrack({ track, retried }: IndexInfo<O>, force: boolean = false) {
    if (force || !track.extra?.tags) {
      const { metadata } = await MetadataHelper.fetchMetadata(track, this.musicDb, force);
      track.musicId = metadata.isrc,
      track.extra = {
        ...track.extra,
        tags: metadata,
        kind: TrackKind.Normal
      };
    }

    try {
      await this.#searchEngine.add(track);
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

      newCollection.on('tracksAdd', this.#handleTrackAddition(newCollection));
      newCollection.on('tracksRemove', this.#handleTrackRemoval);
      newCollection.on('tracksUpdate', this.#handleTrackUpdates);

      newCollection.on('scan' as any, () => {
        this.#logger.info('Start scanning collection \`%s\`', newCollection.extra.description);
      });

      newCollection.on('scan-done' as any, () => {
        this.#logger.info('Finish scanning collection \'%s\'', newCollection.extra.description);
      });

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
