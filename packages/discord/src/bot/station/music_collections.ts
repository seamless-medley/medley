import MiniSearch, { Query, SearchResult } from 'minisearch';
import { BoomBoxTrack, mapTracksMetadataConcurrently, WatchTrackCollection } from "@seamless-medley/core";
import { BaseCollection } from "../utils/collection";
import _, { castArray, difference, flow, get, shuffle } from 'lodash';
import normalizePath from 'normalize-path';
import { Station } from './station';

export type MusicCollectionDescriptor = {
  id: string;
  path: string;
  description?: string;
}

export type MusicCollectionMetadata = MusicCollectionDescriptor & {
  station: Station;
}

export class MusicCollections extends BaseCollection<WatchTrackCollection<BoomBoxTrack, MusicCollectionMetadata>> {
  private miniSearch = new MiniSearch<BoomBoxTrack>({
    fields: ['artist', 'title'],
    extractField: (track, field) => {
      if (field === 'id') {
        return track.id;
      }

      return get(track.metadata?.tags, field);
    }
  });

  private indexNewTracks = async (awaitable: Promise<BoomBoxTrack[]>) => {
    const tracks = await awaitable;
    this.miniSearch.addAllAsync(tracks);
    return tracks;
  }

  private tracksMapper = flow(shuffle, mapTracksMetadataConcurrently, this.indexNewTracks);

  private collectionPaths = new Map<string, string>();

  constructor(readonly station: Station, ...collections: MusicCollectionDescriptor[]) {
    super();

    for (const descriptor of collections) {
      this.addCollection(descriptor);
    }
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

  addCollection(descriptor: MusicCollectionDescriptor) {
    const { id } = descriptor;
    const path = normalizePath(descriptor.path);

    const newCollection = WatchTrackCollection.initWithWatch<BoomBoxTrack, MusicCollectionMetadata>(
      id, `${path}/**/*`,
      {
        tracksMapper: this.tracksMapper
      }
    );

    newCollection.metadata = {
      ...descriptor,
      station: this.station
    };

    const existing = this.get(id);

    if (!existing) {
      newCollection.on('trackRemove', this.handleTrackRemoval);
    } else {
      const existingPath = this.collectionPaths.get(id)!;

      // same collection id, but different path
      if (existingPath !== path) {
        // Unwatch old path
        existing.unwatchAll();
        // Detach event handler
        existing.off('trackRemove', this.handleTrackRemoval);
      }
    }

    this.add(newCollection);
    this.collectionPaths.set(id, path);

    newCollection.once('ready', () => newCollection.shuffle());
  }

  get size(): number {
    return super.size;
  }

  has(id: string): boolean {
    return super.has(id);
  }

  get(id: string): WatchTrackCollection<BoomBoxTrack, MusicCollectionMetadata> | undefined {
    return super.get(id);
  }

  update(descriptors: MusicCollectionDescriptor[]): string[] {
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