import { Medley, PreQueueListener, Queue } from "@medley/medley";
import { EventEmitter } from "stream";
import { Crate, CrateSequencer, TrackCollection } from ".";

export type CollectionID = string;

export class MedleyPlayer extends EventEmitter {
  readonly sequencer: CrateSequencer;

  constructor(crates: Crate[] = []) {
    super();
    this.sequencer = new CrateSequencer(crates);
    //
    this.medley.on('preQueueNext', this.preQueue);
  }

  private queue = new Queue();
  // TODO: Do not expose medley instance, encapulate it with proxy methods
  readonly medley = new Medley(this.queue);

  private currentCrate: Crate | undefined;

  private isTrackLoadable = async (path: string) => this.medley.isTrackLoadable(path);

  private preQueue: PreQueueListener = async (done) => {
    try {
      const nextTrack = await this.sequencer.nextTrack(this.isTrackLoadable);

      if (!nextTrack) {
        done(false);
        return;
      }

      this.queue.add(nextTrack);

      if (this.currentCrate !== nextTrack.crate) {
        // TODO: Event
        this.currentCrate = nextTrack.crate;
      }

      // TODO: Event
      console.log('preQueueNext', nextTrack.path);
      done(true);
      return;
    }
    catch (e) {
      // TODO: Event
      console.log('Error', e);
    }

    done(false);
  }
}