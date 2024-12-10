import { castArray, chain, isString, partition, stubFalse } from 'lodash';
import { TrackCreator, WatchTrackCollection, TrackCollectionBasicOptions, TrackCollectionEvents, WatchPathWithOption, RescanStats, TracksUpdateEvent } from '../collections';
import { Logger, createLogger } from '@seamless-medley/logging';
import { BoomBoxTrack, TrackKind } from '../playout';
import { BaseLibrary } from './library';
import { SearchEngine, Query, TrackDocumentFields, SearchQuery } from './search';
import { MetadataHelper } from '../metadata';
import { FindByCommentOptions, MusicDb } from './music_db';
import { TrackExtraOf, TrackWithCollectionExtra } from '../track';
import { fileExists, scanDir } from './scanner';

export type MusicCollectionWatch = WatchPathWithOption | string;

export type MusicCollectionDescriptor = {
  id: string;
  paths: MusicCollectionWatch[];
  description: string;
} & TrackCollectionBasicOptions;

export type MusicLibraryExtra<O> = {
  description: string;
  owner: O;
}

export type MusicTrack<O> = TrackWithCollectionExtra<BoomBoxTrack, TrackExtraOf<BoomBoxTrack>, MusicLibraryExtra<O>>;

export type MusicTrackCollection<O> = WatchTrackCollection<MusicTrack<O>, TrackExtraOf<MusicTrack<O>>, MusicLibraryExtra<O>>;

export type MusicTrackCollectionEvents<O> = TrackCollectionEvents<MusicTrack<O>>;

type IndexInfo<O> = {
  track: MusicTrack<O>;
  retried?: number;
  succeeded?: boolean;
}

export type LibraryOverallStats = Record<'discovered' | 'indexing' | 'indexed', number>;

export type LibraryRescanStats<O> = RescanStats & {
  elapsedTime: number;
  collection: MusicTrackCollection<O>;
}

export type LibrarySearchParams = {
  q: SearchQuery;
  limit?: number;
  exactMatch?: boolean;
}

export interface MusicLibraryEvents {
  stats(stats: LibraryOverallStats): void;
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

  #overallStats: LibraryOverallStats = {
    discovered: 0,
    indexing: 0,
    indexed: 0
  }

  private set overallStats(newStats: Partial<LibraryOverallStats>) {
    this.#overallStats = {
      ...this.#overallStats,
      ...newStats
    }

    this.emit('stats', this.#overallStats);
  }

  get overallStats() {
    return this.#overallStats;
  }

  #trackCreator: TrackCreator<MusicTrack<O>> = async (path) => {
    const fromDb = await this.musicDb.findByPath(path);

    if (!fromDb) {
      return;
    }

    const { trackId: id, timestamp, ...tags } = fromDb;

    return {
      id,
      path,
      musicId: fromDb.isrc,
      extra: {
        kind: TrackKind.Normal,
        timestamp,
        tags
      }
    }
  }

  #collectionEventHandlers = new WeakMap<WatchTrackCollection<MusicTrack<O>, TrackExtraOf<MusicTrack<O>>, MusicLibraryExtra<O>>, Record<any, Function>>();

  #handleTrackAddition = (collection: WatchTrackCollection<MusicTrack<O>, TrackExtraOf<MusicTrack<O>>, MusicLibraryExtra<O>>) => (tracks: Array<MusicTrack<O>>, chunkIndex: number, totalChunks: number) => {
    this.overallStats = {
      discovered: this.#overallStats.discovered + tracks.length
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
    this.overallStats = {
      indexing: this.#overallStats.indexing + infos.length
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

    this.overallStats = {
      discovered: this.#overallStats.discovered - tracks.length,
      indexed: this.#overallStats.indexed - tracks.length
    }
  }

  #handleTracksUpdate = async (event: TracksUpdateEvent<MusicTrack<O>>) => {
    event.promises.push(new Promise<void>(async (resolve) => {
      await this.#searchEngine.removeAll(event.tracks).catch(e => this.#logger.error(e));

      for (const track of event.tracks) {
        const modified = await this.#indexTrack({ track }, true).then(r => r.modified).catch(stubFalse);

        if (modified) {
          event.updatedTracks.push(track);
        }
      }

      resolve();
    }))
  }

  #handleCollectionScanStart = (collection: WatchTrackCollection<MusicTrack<O>, TrackExtraOf<MusicTrack<O>>, MusicLibraryExtra<O>>) => () => {
    this.#logger.info('Start scanning collection \`%s\`', collection.extra.description);
  }

  #handleCollectionScanDone = (collection: WatchTrackCollection<MusicTrack<O>, TrackExtraOf<MusicTrack<O>>, MusicLibraryExtra<O>>) => () => {
    this.#logger.info('Finish scanning collection \'%s\'', collection.extra.description);
  }

  remove(...collections: Array<string | MusicTrackCollection<O>>) {
    for (const c of collections) {
      const collection =  (typeof c === 'string') ? this.get(c) : c;

      if (collection) {
        collection.unwatchAll();

        const handlers = this.#collectionEventHandlers.get(collection);
        if (handlers) {
          for (const [event, handler] of Object.entries(handlers)) {
            collection.off(event as any, handler);
          }
        }

        this.#collectionEventHandlers.delete(collection);
      }
    }

    super.remove(...collections);
  }

  async #indexTracks(infos: Array<IndexInfo<O>>, done: (failures: Array<IndexInfo<O>>) => void) {
    const failures: Array<IndexInfo<O>> = [];

    await Promise.all(infos.map(info => this.#indexTrack(info)
      .then(() => {
        info.succeeded = true;

        this.overallStats = {
          indexing: this.#overallStats.indexing - 1,
          indexed: this.#overallStats.indexed + 1
        }
      })
      .catch(() => {
        info.retried ??= 0;
        info.retried++;

        this.overallStats = {
          indexing: this.#overallStats.indexing - 1
        }

        if (info.retried <= 3) {
          failures.push(info);
        }
      })
    ));

    done(failures);
  }

  async #indexTrack({ track }: IndexInfo<O>, force: boolean = false) {
    let modified = false;

    if (force || !track.extra?.tags) {
      const { metadata, timestamp, modified: metadataUpdated } = await MetadataHelper.fetchMetadata(track, this.musicDb, force);
      track.musicId = metadata.isrc,
      track.extra = {
        ...track.extra,
        tags: metadata,
        timestamp,
        kind: TrackKind.Normal
      };

      modified = metadataUpdated === true;
    }

    this.#searchEngine.add(track).catch((e) => {
      this.#logger.error(e);
    });

    return { modified };
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

      const newCollection = new WatchTrackCollection<MusicTrack<O>, TrackExtraOf<MusicTrack<O>>, MusicLibraryExtra<O>>(
        id, extra,
        {
          ...options,
          trackCreator: this.#trackCreator,
          scanner: scanDir,
          fileExistentChecker: fileExists
        }
      );

      newCollection.once('ready', () => {
        newCollection.shuffle();
        onceReady?.();
        resolve(newCollection);
      });

      const handlers: Record<string, Function> = {
        tracksAdd: this.#handleTrackAddition(newCollection),
        tracksRemove: this.#handleTrackRemoval,
        tracksUpdate: this.#handleTracksUpdate,
        scan: this.#handleCollectionScanStart(newCollection),
        'scan-done': this.#handleCollectionScanDone(newCollection),
      }

      for (const [event, handler] of Object.entries(handlers)) {
        newCollection.on(event as any, handler);
      }

      this.add(newCollection);
      this.#collectionEventHandlers.set(newCollection, handlers);

      for (const path of paths) {
        newCollection.watch(!isString(path)
          ? path :
          { dir: path, options: {} }
        );
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

  async findTracksByComment(key: string, value: string, options?: FindByCommentOptions) {
    const found = await this.musicDb.findByComment(key, value, options);
    return found
      .map(({ trackId }) => this.findTrackById(trackId))
      .filter((t): t is MusicTrack<O> => t !== undefined)
  }

  async search({ q, limit, exactMatch }: LibrarySearchParams): Promise<Array<MusicTrack<O>>> {
    const { artist, title, query } = q;

    const mainQueries: Array<Query> = [];

    if (artist || title) {
      const titleAndArtistFields: Array<TrackDocumentFields> = [];
      const titleAndArtistValues: Array<Query> = [];

      if (artist) {
        titleAndArtistValues.push({
          queries: (exactMatch ? ['artist'] : ['artist', 'originalArtist', 'albumArtist']).map(artistField => ({
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
      !exactMatch ? { prefix: true, fuzzy: 0.2 } : { prefix: false, fuzzy: false }
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
          q: {
            artist: narrowTerm
          },
          exactMatch: true
        });
      }

      if (field === 'artist' && narrowBy === 'title') {
        // Start showing artist suggestion for a known title
        tracks = await this.search({
          q: { title: narrowTerm }
        });
      }

      if (tracks) {
        return chain(tracks)
          .shuffle()
          .sortBy(t => t.collection.options.auxiliary ? 1 : 0)
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

  async rescan(full?: boolean, scanningCb?: (collection: MusicTrackCollection<O>) => any): Promise<LibraryRescanStats<O>[]> {
    const stats: LibraryRescanStats<O>[] = [];

    for (const collection of this) {
      scanningCb?.(collection);

      const started = performance.now();
      const result = await collection.rescan(full);

      if (result) {
        stats.push({
          ...result,
          collection,
          elapsedTime: (performance.now() - started) / 1000
        });
      }
    }

    return stats;
  }
}
