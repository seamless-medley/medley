import { isFunction, isObject, omitBy } from "lodash";
import { parseLyrics } from "@seamless-medley/utils";

import {
  type BoomBoxTrack,
  type MusicTrack,
  type MusicTrackCollection,
  type MusicTrackCollectionEvents,
  type Station,
  type TrackCollectionView,
  type TrackKind as CoreTrackKind,
  isRequestTrack,
  BoomBoxTrackExtra,
  BoomBoxTrackPlay
} from "../../../core";

import { MixinEventEmitterOf } from "../../socket";

import type {
  Collection,
  CollectionView,
  IdOnly,
  LatchSession,
  Sequencing,
  SequencingLatch,
  Track,
  TrackCollection,
  TrackExtra,
  TrackKind,
  TrackPlay,
  TrackSequencing,
  TrackSequencingLatch,
  Exposable
} from "@seamless-medley/remote";

export const pickId = <T extends { id: any }>({ id }: T): IdOnly<T> => ({ id });

export const toRemoteTrack = async (
  track: BoomBoxTrack,
  noCover?: boolean
): Promise<Track> => {
  const { id, path, musicId, cueInPosition, cueOutPosition, disableNextLeadIn, extra, sequencing, collection } = track;

  const actualExtra = isRequestTrack(track) ? track.original.extra : extra;

  return {
    id,
    path,
    musicId,
    cueInPosition,
    cueOutPosition,
    disableNextLeadIn,
    extra: actualExtra ? await toRemoteTrackExtra(actualExtra, noCover) : undefined,
    sequencing: sequencing ? toRemoteTrackSequencing(sequencing): undefined,
    collection: toRemoteTrackCollection(collection)
  }
}

const trackKinds = ['normal', 'request', 'insert'] as const;

export const trackKindToString = (k: CoreTrackKind): TrackKind => trackKinds[k.valueOf()];

export const toRemoteTrackExtra = async (
  { kind, source, tags, maybeCoverAndLyrics }: BoomBoxTrackExtra,
  noCover?: boolean
): Promise<TrackExtra> => {
  const coverAndLyrics = !noCover ? await maybeCoverAndLyrics : undefined;
  const lyrics = coverAndLyrics ? parseLyrics(coverAndLyrics?.lyrics, { bpm: tags?.bpm }) : undefined;

  return {
    kind: trackKindToString(kind),
    source,
    tags,
    coverAndLyrics: coverAndLyrics ? {
      ...coverAndLyrics,
      lyrics: lyrics!
    } : undefined
  }
}

export const toRemoteTrackCollection = (collection: BoomBoxTrack['collection']): TrackCollection => {
  return {
    id: collection.id,
    description: collection.extra?.description
  }
}

export const toRemoteTrackSequencing = ({ playOrder, crate, latch }: Sequencing): TrackSequencing => ({
  playOrder,
  crate: pickId(crate),
  latch: latch ? toRemoteTrackSequencingLatch(latch) : undefined
});

export const toRemoteTrackSequencingLatch = (
  {
    order,
    session
  }: SequencingLatch
): TrackSequencingLatch => ({
  order,
  session: toRemoteLatchSession(session)
});

export const toRemoteLatchSession = (
  {
    uuid,
    count,
    max: max,
    collection
  } : NonNullable<SequencingLatch['session']>
): LatchSession => ({
  uuid,
  count,
  max: max,
  collection: toRemoteTrackCollection(collection)
})

export const toRemoteTrackPlay = async ({ uuid, track, duration }: BoomBoxTrackPlay): Promise<TrackPlay> => ({
  uuid,
  duration,
  track: await toRemoteTrack(track),
});

export class ExposedCollection extends MixinEventEmitterOf<Collection>() implements Exposable<Collection> {
  $Exposing: MusicTrackCollection<Station>;
  $Kind = 'collection';

  constructor(collection: MusicTrackCollection<Station>) {
    super();

    this.$Exposing = collection;

    this.#collection.on('refresh', this.#onRefresh);
    this.#collection.on('trackShift', this.#onTracksShift);
    this.#collection.on('trackPush', this.#onTracksPush);
    this.#collection.on('tracksAdd', this.#onTracksAdd);
    this.#collection.on('tracksRemove', this.#onTracksRemove);
  }

  dispose() {
    this.#collection.off('refresh', this.#onRefresh);
    this.#collection.off('trackShift', this.#onTracksShift);
    this.#collection.off('trackPush', this.#onTracksPush);
    this.#collection.off('tracksAdd', this.#onTracksAdd);
    this.#collection.off('tracksRemove', this.#onTracksRemove);
  }

  get #collection() {
    return this.$Exposing;
  }

  #onRefresh: MusicTrackCollectionEvents<Station>['refresh'] = () => {
    this.emit('refresh');
  }

  #onTracksShift: MusicTrackCollectionEvents<Station>['trackShift'] = async (track) => {
    this.emit('trackShift', await toRemoteTrack(track, true));
  }

  #onTracksPush: MusicTrackCollectionEvents<Station>['trackPush'] = async (track) => {
    this.emit('trackPush', await toRemoteTrack(track, true));
  }

  #onTracksAdd: MusicTrackCollectionEvents<Station>['tracksAdd'] = async (tracks) => {
    this.emit('tracksAdd',
      await Promise.all(tracks.map(t => toRemoteTrack(t, true)))
    );
  }

  #onTracksRemove: MusicTrackCollectionEvents<Station>['tracksRemove'] = async (tracks) => {
    this.emit('tracksRemove',
      await Promise.all(tracks.map(t => toRemoteTrack(t, true)))
    );
  }

  get id() {
    const { owner: station } = this.#collection.extra;
    return `${station.id}/${this.#collection.id}`;
  }

  get description() {
    return this.#collection.extra.description;
  }

  get options() {
    return omitBy(this.#collection.options, v => isObject(v) || isFunction(v));
  }

  get length() {
    return this.#collection.length;
  }

  get ready() {
    return this.#collection.ready;
  }

  clear() {
    this.#collection.clear();
  }

  shuffle() {
    this.#collection.shuffle();
  }

  async all() {
    return Promise.all(this.#collection.all().map(t => toRemoteTrack(t, true)));
  }

  createView(numItems: number, topIndex?: number): Exposable<CollectionView> {
    return new ExposedCollectionView(this.#collection.createView(numItems, topIndex));
  }
}

export class ExposedCollectionView extends MixinEventEmitterOf<CollectionView>() implements Exposable<CollectionView> {
  $Exposing: TrackCollectionView<MusicTrack<Station>>;
  $Kind = 'collection_view';

  constructor(collection: TrackCollectionView<MusicTrack<Station>>) {
    super();

    this.$Exposing = collection;
  }

  get #view() {
    return this.$Exposing;
  }

  get length() {
    return this.#view.length;
  }

  set length(val) {
    this.#view.length = val;
  }

  get topIndex() {
    return this.#view.topIndex;
  }

  set topIndex(val) {
    this.#view.topIndex = val;
  }

  get bottomIndex() {
    return this.#view.bottomIndex;
  }

  get ranges() {
    return this.#view.ranges;
  }

  dispose(): void {
    this.#view.dispose();
  }

  updateView(topIndex: number, length: number): void {
    this.#view.updateView(topIndex, length);
  }

  absolute(localIndex: number): number {
    return this.#view.absolute(localIndex);
  }

  isIndexInView(absoluteIndex: number): boolean {
    return this.#view.isIndexInView(absoluteIndex);
  }

  async at(index: number) {
    const track = this.#view.at(index);
    return track ? toRemoteTrack(track) : undefined;
  }

  async items() {
    return Promise.all(this.#view.items().map(item => toRemoteTrack(item)));
  }
}
