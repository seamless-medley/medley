import _, { flatten, some, toLower, trim, uniq } from "lodash";
import { EventEmitter } from "stream";
import type { ICommonTagsResult } from "music-metadata";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, PreQueueListener, Queue, TrackPlay } from "@medley/medley";
import { Crate, CrateSequencer } from "../crate";
import { Track } from "../track";
import { TrackCollection, TrackPeek } from "../collections";
import { getMusicMetadata } from "../utils";
import { SweeperInserter } from "./sweeper";

export enum TrackKind {
  Normal,
  Request,
  Insertion
}

export type BoomBoxMetadata = {
  tags?: ICommonTagsResult;
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
  priority?: number;
  requestedBy?: Requester;
  lastRequestTime?: Date;
};

export function isRequestTrack(o: Track<any>): o is RequestTrack<any> {
  return !!(o as any).requestedBy;
}

export interface BoomBoxEvents {
  sequenceChange: (activeCrate: BoomBoxCrate) => void;
  currentCrateChange: (oldCrate: BoomBoxCrate, newCrate: BoomBoxCrate) => void;
  trackQueued: (track: BoomBoxTrack) => void;
  trackLoaded: (trackPlay: BoomBoxTrackPlay) => void;
  trackStarted: (trackPlay: BoomBoxTrackPlay, lastTrackPlay?: BoomBoxTrackPlay) => void;
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
      noDuplicatedArtist: options.noDuplicatedArtist || 3,
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

      const boomBoxMetadata: BoomBoxMetadata = { tags: musicMetadata.common, kind: TrackKind.Normal };
      const playedArtists = flatten(this.artistHistory).map(toLower);
      const currentArtists = getArtists(boomBoxMetadata).map(toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));
      return !dup ? boomBoxMetadata : false;
    }
    catch {

    }

    return true;
  }

  request(track: BoomBoxTrack, requestedBy?: Requester): TrackPeek<RequestTrack<Requester>> {
    const existing = this.requests.fromId(track.id);

    if (existing) {
      existing.priority = (existing.priority || 0) + 1;
      existing.lastRequestTime = new Date();

      this.requests.sort(t => -(t.priority || 0), t => (t.lastRequestTime?.valueOf() || 0));
      return {
        index: this.requests.indexOf(existing),
        track: existing
      }
    }

    const requested: RequestTrack<Requester> = {
      ...track,
      priority: 0,
      requestedBy,
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

  private async fetchRequestTrack(): Promise<RequestTrack<Requester> | undefined> {
    while (this.requests.length) {
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

  private deckLoaded: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    console.log(`Deck ${deck} loaded`, trackPlay);
    this.emit('trackLoaded', trackPlay);
  }

  private deckStarted: DeckListener<BoomBoxTrack> = (deck, trackPlay) => {
    if (trackPlay.track.metadata?.kind === TrackKind.Insertion) {
      console.log('Playing insertion, do not track history', trackPlay.track.path);
      return;
    }

    console.log(`Deck ${deck} started`, trackPlay.track.metadata?.tags?.title);

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

  const { artist, artists = [] } = metadata.tags;

  if (artist) {
    artists.push(artist);
  }

  return uniq(artists).map(trim);
}

export const mapTracksMetadata = async (tracks: BoomBoxTrack[]) => Promise.all(tracks.map(async track => ({
  ...track,
  metadata: {
    tags: (await getMusicMetadata(track.path))?.common,
    kind: TrackKind.Normal
  }
})));