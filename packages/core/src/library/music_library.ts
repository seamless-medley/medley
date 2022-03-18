import _, { castArray, difference, get, noop } from 'lodash';
import MiniSearch, { Query, SearchResult } from 'minisearch';
import normalizePath from 'normalize-path';
import { WatchTrackCollection } from '../collections';
import { BoomBoxTrack, MetadataHelper, TrackKind } from '../playout';
import { MetadataCache } from '../playout/metadata/cache';
import { breath } from '../utils';
import { BaseLibrary } from './library';

export type MusicLibraryDescriptor = {
  id: string;
  path: string;
  description?: string;
  auxiliary?: boolean;
}

export type MusicLibraryMetadata<O> = MusicLibraryDescriptor & {
  owner: O;
}

export class MusicLibrary<O> extends BaseLibrary<WatchTrackCollection<BoomBoxTrack, MusicLibraryMetadata<O>>> {
  private miniSearch = new MiniSearch<BoomBoxTrack>({
    fields: ['artist', 'title'],
    extractField: (track, field) => {
      if (field === 'id') {
        return track.id;
      }

      return get(track.metadata?.tags, field);
    }
  });

  private collectionPaths = new Map<string, string>();

  constructor(readonly owner: O, readonly metadataCache: MetadataCache | undefined, collections: MusicLibraryDescriptor[]) {
    super();
    this.loadCollections(collections);
  }

  async loadCollections(collections: MusicLibraryDescriptor[]) {
    return Promise.all(
      collections
        .filter(desc => !desc.auxiliary)
        .map(desc => this.addCollection(desc))
      )
      .then(async () => {
        const aux = collections.filter(desc => desc.auxiliary);
        let count: number;

        const setCount = (newCount: number) => {
          count = newCount;

          if (count <= 0) {
            this.emit('ready');
          }
        }

        setCount(aux.length);

        for (const descriptor of aux) {
          await this.addCollection(descriptor, () => setCount(count - 1)).then(breath)
        }
      })
  }

  private handleTrackRemoval = (tracks: BoomBoxTrack[]) => {
    this.miniSearch.removeAll(tracks);
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

  private async indexTracks(collection: WatchTrackCollection<BoomBoxTrack, MusicLibraryMetadata<O>>, tracks: BoomBoxTrack[], done: () => void) {
    if (tracks.length <= 0) {
      done();
      return;
    }

    const [track, ...remainings] = tracks;

    if (!track.metadata) {
      await helper.fetchMetadata(track, this.metadataCache)
        .then(async ({ hit, metadata: tags }) => {
          track.metadata = {
            tags,
            kind: TrackKind.Normal
          };

          this.miniSearch.add(track);
        })
        .catch(noop);
    }

    setTimeout(() => this.indexTracks(collection, remainings, done), 0);
  }

  addCollection(descriptor: MusicLibraryDescriptor, onceReady?: () => void) {
    return new Promise<void>((resolve) => {
      const { id } = descriptor;
      const path = normalizePath(descriptor.path);

      const newCollection = WatchTrackCollection.initWithWatch<BoomBoxTrack, MusicLibraryMetadata<O>>(
        id, `${path}/**/*`
      );

      newCollection.on('tracksAdd', tracks => {
        this.indexTracks(newCollection, tracks, resolve);
      });

      newCollection.metadata = {
        ...descriptor,
        owner: this.owner
      };

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

      newCollection.once('ready', () => {
        newCollection.shuffle();
        onceReady?.();
      });

      return newCollection;
    });
  }

  get size(): number {
    return super.size;
  }

  has(id: string): boolean {
    return super.has(id);
  }

  get(id: string): WatchTrackCollection<BoomBoxTrack, MusicLibraryMetadata<O>> | undefined {
    return super.get(id);
  }

  update(descriptors: MusicLibraryDescriptor[]): string[] {
    const removingIds = difference(
      [...this.elements.keys()],
      descriptors.map(desc => desc.id)
    );

    this.remove(...removingIds);

    for (const descriptor of descriptors) {
      this.addCollection(descriptor);
    }

    return removingIds;
  }

  findTrackById(id: BoomBoxTrack['id']) {
    for (const collection of this) {
      const track = collection.fromId(id);
      if (track) {
        return track;
      }
    }
  }

  async buildCache(progressCallback?: (progress: number, outOf: number) => any): Promise<number> {
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

        const metadata = track.metadata?.tags;

        if (metadata) {
          cache.persist(track, metadata).catch(noop);
        }

        progressCallback?.(total - remainings.length, total);
        setTimeout(() => process(remainings), 0);
      }

      process(allTracks);
    });
  }

  search(q: Record<'artist' | 'title' | 'query', string | null>, limit?: number): BoomBoxTrack[] {
    const { artist, title, query } = q;

    const queries: Query[] = [];

    if (artist || title) {
      const fields: string[] = [];
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

    const chain = _(this.miniSearch.search({ queries, combineWith: 'OR' }, { prefix: true, fuzzy: 0.2 }))
      .sortBy(s => -s.score)
      .map(t => this.findTrackById(t.id))
      .filter((t): t is BoomBoxTrack => t !== undefined)
      .uniqBy(t => t.id)

    return (limit ? chain.take(limit) : chain).value();
  }

  autoSuggest(q: string, field?: string, narrowBy?: string, narrowTerm?: string) {
    const nt = narrowTerm?.toLowerCase();

    if (!q && field === 'title' && narrowBy === 'artist' && narrowTerm) {
      // Start showing title suggestion for a known artist
      const tracks = this.search({
        artist: narrowTerm,
        title: null,
        query: null
      });

      return _(tracks).map(t => t.metadata?.tags?.title).filter(_.isString).uniq().value();
    }

    const narrow = (narrowBy && nt)
      ? (result: SearchResult): boolean => {
        const track = this.findTrackById(result.id);
        const narrowing = (track?.metadata?.tags as any || {})[narrowBy] as string | undefined;
        const match = narrowing?.toLowerCase().includes(nt) || false;
        return match;
      }
      : undefined;

    return this.miniSearch.autoSuggest(
      q,
      {
        fields: field ? castArray(field) : undefined,
        prefix: true,
        fuzzy: 0.5,
        filter: narrow
      }
    ).map(s => s.suggestion);
  }
}

const helper = new MetadataHelper();