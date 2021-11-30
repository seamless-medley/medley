import { parse as parsePath } from 'path';
import _, { flatten, some, toLower, trim, uniq } from "lodash";
import { EventEmitter } from "stream";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, PreQueueListener, Queue, TrackPlay, Metadata, CoverAndLyrics } from "@medley/medley";
import { Crate, CrateSequencer } from "../crate";
import { Track } from "../track";
import { TrackCollection, TrackPeek } from "../collections";
import { getMusicMetadata, getMusicCoverAndLyrics } from "../utils";
import { SweeperInserter } from "./sweeper";

export enum TrackKind {
  Normal,
  Request,
  Insertion
}

export type BoomBoxMetadata = {
  tags?: Metadata;
  coverAndLyrics?: CoverAndLyrics;
  kind: TrackKind;
};

export type BoomBoxTrack = Track<BoomBoxMetadata>;
export type BoomBoxTrackPlay = TrackPlay<BoomBoxTrack>;
export type BoomBoxCrate = Crate<BoomBoxTrack>;

export type TrackRecord = {
  trackPlay: BoomBoxTrackPlay;
  playedTime: Date;
}

export type RequestTrack<Requester> = BoomBoxTrack & {
  rid: number;
  priority?: number;
  requestedBy: Requester[];
  lastRequestTime?: Date;
};

export function isRequestTrack<T>(o: any): o is RequestTrack<T> {
  return o && !!o.requestedBy;
}

export interface BoomBoxEvents {
  sequenceChange: (activeCrate: BoomBoxCrate) => void;
  currentCollectionChange: (oldCollection: TrackCollection<BoomBoxTrack>, newCollection: TrackCollection<BoomBoxTrack>) => void;
  currentCrateChange: (oldCrate: BoomBoxCrate, newCrate: BoomBoxCrate) => void;
  trackQueued: (track: BoomBoxTrack) => void;
  trackLoaded: (trackPlay: BoomBoxTrackPlay) => void;
  trackStarted: (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => void;
  trackActive: (trackPlay: BoomBoxTrackPlay) => void;
  trackFinished: (trackPlay: BoomBoxTrackPlay) => void;
  requestTrackFetched: (track: RequestTrack<any>) => void;
  error: (error: Error) => void;
}

type BoomBoxOptions = {
  medley: Medley<BoomBoxTrack>;
  queue: Queue<BoomBoxTrack>;
  crates: BoomBoxCrate[];

  /**
   * Initalize artist history
   */
  artistHistory?: string[][];

  /**
   * Number of maximum track history
   */
  maxTrackHistory?: number;

  /**
   * Number of tracks to be kept to be check for duplication
   * Default value is 50
   * `false` means no duplication check should be done
   *
   * @default 50
   */
  noDuplicatedArtist?: number | false;

  /**
   * Similarity threshold for the artist to be considered as dupplicated
   *
   * @default 0.8
   */
  duplicationSimilarity?: number;

}

export class BoomBox<Requester = any> extends (EventEmitter as new () => TypedEventEmitter<BoomBoxEvents>) {
  readonly sequencer: CrateSequencer<BoomBoxTrack>;

  private options: Required<Omit<BoomBoxOptions, 'medley' | 'queue' | 'crates' | 'artistHistory'>>;

  readonly medley: Medley<BoomBoxTrack>;
  readonly queue: Queue<BoomBoxTrack>;

  artistHistory: string[][];

  trackHistory: TrackRecord[] = [];

  constructor(options: BoomBoxOptions) {
    super();
    //
    this.options = {
      noDuplicatedArtist: options.noDuplicatedArtist || 50,
      duplicationSimilarity: options.duplicationSimilarity || 0.8,
      maxTrackHistory: options.maxTrackHistory || 20
    };
    //
    this.artistHistory = options.artistHistory || [];
    //
    this.medley = options.medley;
    this.queue = options.queue;
    //
    this.medley.on('preQueueNext', this.preQueue);
    this.medley.on('loaded', this.deckLoaded);
    this.medley.on('started', this.deckStarted);
    this.medley.on('finished', this.deckFinished);
    this.medley.on('mainDeckChanged', this.mainDeckChanged);
    //
    this.sequencer = new CrateSequencer<BoomBoxTrack>(options.crates);
    this.sequencer.on('change', (crate: BoomBoxCrate) => this.emit('sequenceChange', crate));
  }

  private sweeperInserter: SweeperInserter = new SweeperInserter(this, []);

  get sweeperInsertionRules() {
    return this.sweeperInserter.rules;
  }

  set sweeperInsertionRules(rules) {
    this.sweeperInserter.rules = rules;
  }

  private _currentCrate: BoomBoxCrate | undefined;
  private _currentTrackPlay: BoomBoxTrackPlay | undefined = undefined;

  get crate() {
    return this._currentCrate;
  }

  get trackPlay() {
    return this._currentTrackPlay;
  }

  private requests: TrackCollection<RequestTrack<Requester>> = new TrackCollection('$_requests');

  private isTrackLoadable = async (path: string) => this.medley.isTrackLoadable(path);

  private validateTrack = async (path: string): Promise<boolean | BoomBoxMetadata> => {
    if (!await this.isTrackLoadable(path)) {
      return false;
    }

    try {
      const musicMetadata = await getMusicMetadata(path);

      if (!musicMetadata) {
        return { kind: TrackKind.Normal };
      }

      const boomBoxMetadata: BoomBoxMetadata = { tags: musicMetadata, kind: TrackKind.Normal };
      const playedArtists = flatten(this.artistHistory).map(toLower);
      const currentArtists = getArtists(boomBoxMetadata).map(toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));
      return !dup ? boomBoxMetadata : false;
    }
    catch {

    }

    return true;
  }

  private _lastRequestId = 0;

  request(track: BoomBoxTrack, requestedBy?: Requester): TrackPeek<RequestTrack<Requester>> {
    const existing = this.requests.fromId(track.id);

    if (existing) {
      existing.priority = (existing.priority || 0) + 1;
      existing.lastRequestTime = new Date();

      if (requestedBy) {
        existing.requestedBy.push(requestedBy)
      }

      this.sortRequests();

      return {
        index: this.requests.indexOf(existing),
        track: existing
      }
    }

    const requested: RequestTrack<Requester> = {
      ...track,
      rid: ++this._lastRequestId,
      priority: 0,
      requestedBy: requestedBy ? [requestedBy]: [],
      lastRequestTime: new Date()
    };

    requested.metadata = {
      ...requested.metadata,
      kind: TrackKind.Request
    }

    const index = this.requests.push(requested);
    return {
      index,
      track: requested
    }
  }

  sortRequests() {
    this.requests.sort(t => -(t.priority || 0), t => (t.lastRequestTime?.valueOf() || 0));
  }

  private _requestsEnabled = true;

  get requestsEnabled() {
    return this._requestsEnabled;
  }

  set requestsEnabled(value: boolean) {
    this._requestsEnabled = value;
  }

  get requestsCount() {
    return this.requests.length;
  }

  private async fetchRequestTrack(): Promise<RequestTrack<Requester> | undefined> {
    while (this._requestsEnabled && this.requests.length) {
      const track = this.requests.shift()!;

      if (await this.isTrackLoadable(track.path)) {
        return track;
      }
    }

    return undefined;
  }

  peekRequests(from: number, n: number) {
    return this.requests.peek(from, n);
  }

  private preQueue: PreQueueListener = async (done) => {
    if (this.queue.length > 0) {
      done(true);
    }

    try {
      const requestedTrack = await this.fetchRequestTrack();
      if (requestedTrack) {
        this.emit('requestTrackFetched', requestedTrack);

        this.queue.add(requestedTrack);
        done(true);
        return;
      }

      const nextTrack = await this.sequencer.nextTrack(this.validateTrack);

      if (!nextTrack) {
        done(false);
        return;
      }

      const currentCollection = this._currentTrackPlay?.track.collection;
      const nextCollection = nextTrack.collection;

      if (currentCollection && nextCollection && currentCollection.id !== nextCollection.id) {
        this.emit('currentCollectionChange', currentCollection, nextCollection);
      }

      if (this._currentCrate !== nextTrack.crate) {

        if (this._currentCrate && nextTrack.crate) {
          this.emit('currentCrateChange', this._currentCrate, nextTrack.crate);
        }

        this._currentCrate = nextTrack.crate;
      }

      this.queue.add(nextTrack);

      this.emit('trackQueued', nextTrack);
      done(true);
      return;
    }
    catch (e) {
      this.emit('error', e as Error);
    }

    done(false);
  }

  private deckLoaded: DeckListener<BoomBoxTrack> = async (deck, trackPlay) => {
    // build cover and lyrics metadata
    // the track might be a request track, which shadowed metadata object from the track in a collection
    // So we need to find the actual track and set extra metadata there
    const { collection } = trackPlay.track;
    if (collection) {
      const trackInCollection = collection.fromId(trackPlay.track.id);

      if (trackInCollection) {
        const { metadata } = trackInCollection;

        if (metadata) {
          if (metadata.kind !== TrackKind.Insertion) {
            metadata.coverAndLyrics = await getMusicCoverAndLyrics(trackPlay.track.path);
          }
        }
      }
    }

    this.emit('trackLoaded', trackPlay);
  }

  private deckStarted: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    const kind = trackPlay.track.metadata?.kind;

    if (kind === undefined || kind === TrackKind.Insertion) {
      return;
    }

    if (this._currentTrackPlay?.uuid === trackPlay.uuid) {
      return;
    }

    const lastTrack = this._currentTrackPlay;
    this._currentTrackPlay = trackPlay;

    this.emit('trackStarted', trackPlay, lastTrack);

    const { maxTrackHistory, noDuplicatedArtist } = this.options;

    if (maxTrackHistory > 0) {
      this.trackHistory.push({
        trackPlay,
        playedTime: new Date()
      });

      while (this.trackHistory.length > maxTrackHistory) {
        this.trackHistory.shift();
      }
    }

    if (noDuplicatedArtist > 0) {
      const { metadata } = trackPlay.track;
      if (metadata) {
        this.artistHistory.push(getArtists(metadata));

        while (this.artistHistory.length > noDuplicatedArtist) {
          this.artistHistory.shift();
        }
      }
    }
  }

  private deckFinished: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    this.emit('trackFinished', trackPlay);
  }

  private mainDeckChanged: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      return;
    }

    this.emit('trackActive', trackPlay);
  }

  get crates() {
    return this.sequencer.crates;
  }

  set crates(value: BoomBoxCrate[]) {
    this.sequencer.crates = value;
  }
}

function getArtists(metadata: BoomBoxMetadata): string[] {
  if (!metadata.tags) {
    return [];
  }

  return uniq(metadata.tags.artist.split(/[/;]/)).map(trim);
}

export const mapTrackMetadata = async (track: BoomBoxTrack): Promise<BoomBoxTrack> => ({
  ...track,
  metadata: {
    tags: await getMusicMetadata(track.path),
    kind: TrackKind.Normal
  }
});

export const mapTracksMetadataConcurrently = async (tracks: BoomBoxTrack[]) => Promise.all(tracks.map(mapTrackMetadata));

export const mapTracksMetadataSequentially = async (tracks: BoomBoxTrack[]) => {
  const results: BoomBoxTrack[] = [];

  for (const track of tracks) {
    results.push(await mapTrackMetadata(track));
  }

  return tracks;
};

export function getTrackBanner(track: BoomBoxTrack) {
  const tags = track.metadata?.tags;
  const info: string[] = [];

  if (tags?.artist) {
    info.push(tags.artist);
  }

  if (tags?.title) {
    info.push(tags.title);
  }

  return info.length ? info.join(' - ') : parsePath(track.path).name;
}