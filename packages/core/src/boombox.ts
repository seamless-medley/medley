import _, { flatten, some, uniq } from "lodash";
import { EventEmitter } from "stream";
import { ICommonTagsResult, parseFile as parseMetadataFromFile } from "music-metadata";
import { compareTwoStrings } from "string-similarity";
import type TypedEventEmitter from "typed-emitter";
import { DeckListener, Medley, PreQueueListener, Queue } from "@medley/medley";
import { Crate, CrateSequencer } from "./crate";
import { Track } from "./track";

export type BoomBoxMetadata = ICommonTagsResult;

export interface BoomBoxEvents {
  sequenceChange: (activeCrate: Crate<BoomBoxMetadata>) => void;
  currentCrateChange: (oldCrate: Crate<BoomBoxMetadata>, newCrate: Crate<BoomBoxMetadata>) => void;
  trackQueued: (track: Track<BoomBoxMetadata>) => void;
  trackLoaded: (track: Track<BoomBoxMetadata>) => void;
  trackStarted: (track: Track<BoomBoxMetadata>) => void;
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


  private currentCrate: Crate<BoomBoxMetadata> | undefined;

  private isTrackLoadable = async (path: string) => this.medley.isTrackLoadable(path);

  private validateTrack = async (path: string): Promise<boolean | BoomBoxMetadata> => {
    if (!await this.isTrackLoadable(path)) {
      return false;
    }

    try {
      const metadata = await parseMetadataFromFile(path);
      const playedArtists = flatten(this.artistHistory).map(_.toLower);
      const currentArtists = getArtists(metadata.common).map(_.toLower);
      const dup = some(playedArtists, a => some(currentArtists, b => compareTwoStrings(a, b) >= this.options.duplicationSimilarity));
      if (dup) {
        console.log('Skipping', path, 'because of artist duplication');
      }
      return !dup ? metadata.common : false;
    }
    catch {

    }

    return true;
  }

  private nextTrack: Track<BoomBoxMetadata> | undefined;

  private preQueue: PreQueueListener = async (done) => {
    try {
      const nextTrack = await this.sequencer.nextTrack(this.validateTrack);

      if (!nextTrack) {
        done(false);
        return;
      }

      this.nextTrack = nextTrack;
      this.queue.add(nextTrack);

      if (this.currentCrate !== nextTrack.crate) {

        if (this.currentCrate && nextTrack.crate) {
          this.emit('currentCrateChange', this.currentCrate, nextTrack.crate);
        }

        this.currentCrate = nextTrack.crate;
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
    if (this.nextTrack) {
      this.emit('trackLoaded', this.nextTrack);
    }
  }

  private deckStarted: DeckListener = (deck) => {
    if (this.nextTrack) {
      this.emit('trackStarted', this.nextTrack);

      const { noDuplicatedArtist } = this.options;

      if (noDuplicatedArtist > 0) {
        const { metadata } = this.nextTrack;
        if (metadata) {
          this.artistHistory.push(getArtists(metadata));

          while (this.artistHistory.length > noDuplicatedArtist) {
            this.artistHistory.shift();
          }
        }
      }
    }

    this.nextTrack = undefined;
  }

  get crates() {
    return this.sequencer.crates;
  }

  set crates(value: Crate<BoomBoxMetadata>[]) {
    this.sequencer.crates = value;
  }
}

function getArtists(metadata: BoomBoxMetadata): string[] {
  const { artist } = metadata;
  const artists = (metadata.artists ?? []);
  if (artist) {
    artists.push(artist);
  }

  return uniq(artists).map(_.trim);
}