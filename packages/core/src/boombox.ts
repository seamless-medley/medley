import _, { flatten, some, uniq } from "lodash";
import { EventEmitter } from "stream";
import { IAudioMetadata, ICommonTagsResult, parseFile as parseMetadataFromFile } from "music-metadata";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, PreQueueListener, Queue } from "@medley/medley";
import { Crate, CrateSequencer } from "./crate";
import { Track } from "./track";
import { TrackCollection } from "./collections";
import { Promise as NodeID3 } from 'node-id3';

type Rotation = 'normal' | 'request';

export type BoomBoxMetadata = {
  tags?: ICommonTagsResult;
  rotation: Rotation;
  priority?: number;
};

export interface BoomBoxEvents {
  sequenceChange: (activeCrate: Crate<BoomBoxMetadata>) => void;
  currentCrateChange: (oldCrate: Crate<BoomBoxMetadata>, newCrate: Crate<BoomBoxMetadata>) => void;
  trackQueued: (track: Track<BoomBoxMetadata>) => void;
  trackLoaded: (track: Track<BoomBoxMetadata>) => void;
  trackStarted: (track: Track<BoomBoxMetadata>, lastTrack?: Track<BoomBoxMetadata>) => void;
  error: (error: Error) => void;
}

type BoomBoxOptions = {
  medley: Medley;
  queue: Queue;
  crates: Crate<BoomBoxMetadata>[];

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
  readonly sequencer: CrateSequencer<BoomBoxMetadata>;

  private options: Required<Omit<BoomBoxOptions, 'medley' | 'queue' | 'crates' | 'artistHistory'>>;

  private medley: Medley;
  private queue: Queue;

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
    this.sequencer = new CrateSequencer<BoomBoxMetadata>(options.crates);
    this.sequencer.on('change', (crate: Crate) => this.emit('sequenceChange', crate as unknown as Crate<BoomBoxMetadata>));
  }

  private _currentCrate: Crate<BoomBoxMetadata> | undefined;
  private _currentTrack: Track<BoomBoxMetadata> | undefined = undefined;
  private _nextTrack: Track<BoomBoxMetadata> | undefined;

  get crate() {
    return this._currentCrate;
  }

  get track() {
    return this._currentTrack;
  }

  get nextTrack() {
    return this._nextTrack;
  }

  private async getMusicMetadata(path: string): Promise<IAudioMetadata | undefined> {
    try {
      const result = await parseMetadataFromFile(path);
      const { common, format: { tagTypes = [] }} = result;
      const hasLyrics = common.lyrics?.length === 1;

      if (hasLyrics) {
        return result;
      }

      // No lyrics detcted, or mis-interpreted
      // music-metadata does not map TXXX:LYRICS into the lyrics field

      // Try looking up from ID3v2
      const id3Types = _.intersection(tagTypes, ['ID3v2.3', 'ID3v2.4']);
      for (const tagType of id3Types) {
        const tags = result.native[tagType];

        const uslt = tags.find(t => t.id === 'USLT');
        if (uslt) {
          const value = _.get(uslt, 'value.text');
          if (value) {
            result.common.lyrics = [value];
            break;
          }
        }

        const lyricTags = tags.filter(t => t.id === 'TXXX:LYRICS');
        if (lyricTags.length === 1) {
          const { value } = lyricTags[0];
          if (value) {
            result.common.lyrics = [value];
            break;
          }
        }

        // This is rare: Although, TXXX:LYRICS was found, but somehow music-metadata read it incorrectly, where it tries to split tag value by a slash
        // We will use node-id3 to extract TXXX instead
        const { userDefinedText: customTags } = await NodeID3.read(path, { include: ['TXXX'] });
        const foundTag = customTags?.find(t => t.description === 'LYRICS');

        if (foundTag) {
          result.common.lyrics = [foundTag.value];
        }
      }

      return result;
    }
    catch {

    }
  }

  private requests: TrackCollection<BoomBoxMetadata> = new TrackCollection('$_requests');

  private isTrackLoadable = async (path: string) => this.medley.isTrackLoadable(path);

  private validateTrack = async (path: string): Promise<boolean | BoomBoxMetadata> => {
    if (!await this.isTrackLoadable(path)) {
      return false;
    }

    try {
      const musicMetadata = await this.getMusicMetadata(path);

      if (!musicMetadata) {
        return { rotation: 'normal' };
      }

      const boomBoxMetadata: BoomBoxMetadata = { tags: musicMetadata.common, rotation: 'normal' };
      const playedArtists = flatten(this.artistHistory).map(_.toLower);
      const currentArtists = getArtists(boomBoxMetadata).map(_.toLower);
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
        const musicMetadata = await this.getMusicMetadata(track.path);

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
    try {
      const requestedTrack = await this.fetchRequestTrack();
      if (requestedTrack) {
        console.log('Got track from request');
        // TODO: Detect transition from normal rotation to request rotation
        // if this is the case, call a callback for providing sweeper/bumper/sting track to play before actually playing the requested track
        this._nextTrack = requestedTrack;
        this.queue.add(requestedTrack);

        done(true);
        return;
      }

      const nextTrack = await this.sequencer.nextTrack(this.validateTrack);

      if (!nextTrack) {
        done(false);
        return;
      }

      this._nextTrack = nextTrack;
      this.queue.add(nextTrack);

      if (this._currentCrate !== nextTrack.crate) {

        if (this._currentCrate && nextTrack.crate) {
          this.emit('currentCrateChange', this._currentCrate, nextTrack.crate);
        }

        this._currentCrate = nextTrack.crate;
      }

      this.emit('trackQueued', nextTrack);
      done(true);
      return;
    }
    catch (e) {
      this.emit('error', e as Error);
    }

    done(false);
  }

  private deckLoaded: DeckListener = (deck) => {
    if (this._nextTrack) {
      this.emit('trackLoaded', this._nextTrack);
    }
  }

  private deckStarted: DeckListener = (deck) => {
    if (this._nextTrack) {
      const newTrack = this._nextTrack;
      const lastTrack = this._currentTrack;

      this._currentTrack = newTrack;
      this._nextTrack = undefined;

      this.emit('trackStarted', newTrack, lastTrack);

      const { noDuplicatedArtist } = this.options;

      if (noDuplicatedArtist > 0) {
        const { metadata } = newTrack;
        if (metadata) {
          this.artistHistory.push(getArtists(metadata));

          while (this.artistHistory.length > noDuplicatedArtist) {
            this.artistHistory.shift();
          }
        }
      }
    }

    this._nextTrack = undefined;
  }

  get crates() {
    return this.sequencer.crates;
  }

  set crates(value: Crate<BoomBoxMetadata>[]) {
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

  return uniq(artists).map(_.trim);
}