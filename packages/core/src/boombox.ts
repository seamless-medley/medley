import _, { flatten, get, intersection, some, toLower, trim, uniq } from "lodash";
import { EventEmitter } from "stream";
import { IAudioMetadata, ICommonTagsResult, parseFile as parseMetadataFromFile } from "music-metadata";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, PreQueueListener, Queue } from "@medley/medley";
import { Crate, CrateSequencer } from "./crate";
import { Track } from "./track";
import { TrackCollection } from "./collections";
import { getMusicMetadata } from "./utils";

type Rotation = 'normal' | 'request' | 'insertion';

export type BoomBoxMetadata = {
  tags?: ICommonTagsResult;
  rotation: Rotation;
  priority?: number;

  // TODO: Callback for providing insertion for requedted track
};

export type BoomBoxTrack = Track<BoomBoxMetadata>;
export type BoomBoxCrate = Crate<BoomBoxTrack>;

export interface BoomBoxEvents {
  sequenceChange: (activeCrate: BoomBoxCrate) => void;
  currentCrateChange: (oldCrate: BoomBoxCrate, newCrate: BoomBoxCrate) => void;
  trackQueued: (track: BoomBoxTrack) => void;
  trackLoaded: (track: BoomBoxTrack) => void;
  trackStarted: (track: BoomBoxTrack, lastTrack?: BoomBoxTrack) => void;
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

export class BoomBox extends (EventEmitter as new () => TypedEventEmitter<BoomBoxEvents>) {
  readonly sequencer: CrateSequencer<BoomBoxTrack>;

  private options: Required<Omit<BoomBoxOptions, 'medley' | 'queue' | 'crates' | 'artistHistory'>>;

  private medley: Medley<BoomBoxTrack>;
  private queue: Queue<BoomBoxTrack>;

  artistHistory: string[][];

  constructor(options: BoomBoxOptions) {
    super();
    //
    this.options = {
      noDuplicatedArtist: options.noDuplicatedArtist || 3,
      duplicationSimilarity: options.duplicationSimilarity || 0.8
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
    //
    this.sequencer = new CrateSequencer<BoomBoxTrack>(options.crates);
    this.sequencer.on('change', (crate: BoomBoxCrate) => this.emit('sequenceChange', crate));
  }

  private _currentCrate: BoomBoxCrate | undefined;
  private _currentTrack: BoomBoxTrack | undefined = undefined;

  get crate() {
    return this._currentCrate;
  }

  get track() {
    return this._currentTrack;
  }



  private requests: TrackCollection<BoomBoxTrack> = new TrackCollection('$_requests');

  private isTrackLoadable = async (path: string) => this.medley.isTrackLoadable(path);

  private validateTrack = async (path: string): Promise<boolean | BoomBoxMetadata> => {
    if (!await this.isTrackLoadable(path)) {
      return false;
    }

    try {
      const musicMetadata = await getMusicMetadata(path);

      if (!musicMetadata) {
        return { rotation: 'normal' };
      }

      const boomBoxMetadata: BoomBoxMetadata = { tags: musicMetadata.common, rotation: 'normal' };
      const playedArtists = flatten(this.artistHistory).map(toLower);
      const currentArtists = getArtists(boomBoxMetadata).map(toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));
      return !dup ? boomBoxMetadata : false;
    }
    catch {

    }

    return true;
  }

  private async fetchRequestTrack(): Promise<Track<BoomBoxMetadata> | undefined> {
    while (this.requests.length) {
      const track = this.requests.shift()!;
      if (await this.isTrackLoadable(track.path)) {
        const musicMetadata = await getMusicMetadata(track.path);

        track.metadata = {
          tags: musicMetadata?.common,
          rotation: 'request',
          priority: 0
        };

        return track;
      }
    }

    return undefined;
  }

  request(path: string) {
    const existing = this.requests.find(path);
    if (!existing) {
      this.requests.add(path);
      return;
    }

    if (existing.metadata) {
      existing.metadata.priority = (existing.metadata.priority || 0) + 1;
    }
  }

  private preQueue: PreQueueListener = async (done) => {
    if (this.queue.length > 0) {
      done(true);
    }

    try {
      const requestedTrack = await this.fetchRequestTrack();
      if (requestedTrack) {
        console.log('Got track from request');
        // TODO: Detect transition from normal rotation to request rotation
        // if this is the case, call a callback for providing sweeper/bumper/sting track to play before actually playing the requested track

        const currentRotation = this._currentTrack?.metadata?.rotation || 'normal';

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

  private deckLoaded: DeckListener<BoomBoxTrack> = (deck, track) => {
    console.log(`Deck ${deck} loaded`, track.path);
  }

  private deckStarted: DeckListener<BoomBoxTrack> = (deck, track) => {
    if (track?.metadata?.rotation === 'insertion') {
      console.log('Playing insertion, do not track history', track.path);
      return;
    }

    console.log(`Deck ${deck} started`, track?.metadata?.tags?.title);

    const lastTrack = this._currentTrack;
    this._currentTrack = track;

    this.emit('trackStarted', track, lastTrack);

    const { noDuplicatedArtist } = this.options;

    if (noDuplicatedArtist > 0) {
      const { metadata } = track;
      if (metadata) {
        this.artistHistory.push(getArtists(metadata));

        while (this.artistHistory.length > noDuplicatedArtist) {
          this.artistHistory.shift();
        }
      }
    }
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