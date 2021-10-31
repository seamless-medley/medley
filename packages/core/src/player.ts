import { EventEmitter } from "stream";
import type TypedEventEmitter from "typed-emitter";
import { ICommonTagsResult, parseFile as parseMetadataFromFile } from "music-metadata";
import { DeckListener, Medley, PreQueueListener, Queue } from "@medley/medley";
import { Crate, CrateSequencer } from "./crate";
import { Track } from "./track";

export type MedleyPlayerMetadata = ICommonTagsResult;

export interface MedleyPlayerEvents {
  sequenceChange: (activeCrate: Crate<MedleyPlayerMetadata>) => void;
  currentCrateChange: (oldCrate: Crate<MedleyPlayerMetadata>, newCrate: Crate<MedleyPlayerMetadata>) => void;
  trackQueued: (track: Track<MedleyPlayerMetadata>) => void;
  trackLoaded: (track: Track<MedleyPlayerMetadata>) => void;
  error: (error: Error) => void;
}

// TODO: Options
type MedleyPlayerOptions = {
  medley: Medley;
  queue: Queue;
  crates: Crate<MedleyPlayerMetadata>[];
  /**
   * Number of last tracks that artist name will be kept
   * Any new track containing these artists will be skipped
   */
  noDuplicatedArtist: number;
  // TODO: Sting similarity threshold for matching artist
}
export class MedleyPlayer extends (EventEmitter as new () => TypedEventEmitter<MedleyPlayerEvents>) {
  readonly sequencer: CrateSequencer<MedleyPlayerMetadata>;

  constructor(private medley: Medley, private queue: Queue, crates: Crate<MedleyPlayerMetadata>[] = []) {
    super();
    this.sequencer = new CrateSequencer<MedleyPlayerMetadata>(crates);
    this.sequencer.on('change', (crate: Crate) => this.emit('sequenceChange', crate as unknown as Crate<MedleyPlayerMetadata>));
    //
    this.medley.on('preQueueNext', this.preQueue);
    this.medley.on('loaded', this.deckLoaded);
    this.medley.on('started', this.deckStarted);
  }

  private currentCrate: Crate<MedleyPlayerMetadata> | undefined;

  private isTrackLoadable = async (path: string) => this.medley.isTrackLoadable(path);

  private validateTrack = async (path: string): Promise<boolean | MedleyPlayerMetadata> => {
    if (!await this.isTrackLoadable(path)) {
      return false;
    }

    try {
      const metadata = await parseMetadataFromFile(path);
      // TODO: Check for artist duplication
      // TODO: Store artists
      return metadata.common;
    }
    catch {

    }

    return true;
  }

  private nextTrack: Track<MedleyPlayerMetadata> | undefined;

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
    console.log('Deck', deck, 'loaded', this.nextTrack);
  }

  private deckStarted: DeckListener = (deck) => {
    console.log('Deck', deck, 'start', this.nextTrack);

    this.nextTrack = undefined;
  }

  get crates() {
    return this.sequencer.crates;
  }

  set crates(value: Crate<MedleyPlayerMetadata>[]) {
    this.sequencer.crates = value;
  }
}