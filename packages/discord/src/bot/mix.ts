import {
  AudioPlayer,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus
} from "@discordjs/voice";
import { BoomBox, BoomBoxEvents, BoomBoxTrack, Crate, mapTracksMetadata, Medley, Queue, RequestAudioStreamResult, SweeperInsertionRule, TrackCollection, WatchTrackCollection } from "@medley/core";
import { BaseGuildVoiceChannel } from "discord.js";
import EventEmitter from "events";
import type TypedEventEmitter from 'typed-emitter';
import _, { flow, shuffle } from "lodash";

export type MedleyMixOptions = {

}

export type SweeperConfig = {
  from?: string[];
  to?: string[];
  path: string;
}

export interface MedleyMixEvents extends Pick<BoomBoxEvents, 'trackQueued' | 'trackLoaded' | 'trackStarted'> {

}

// This is the DJ
export class MedleyMix extends (EventEmitter as new () => TypedEventEmitter<MedleyMixEvents>) {
  private queue: Queue<BoomBoxTrack>;
  private medley: Medley<BoomBoxTrack>;

  private audioRequest: RequestAudioStreamResult;
  private audioResource: AudioResource;
  private audioPlayer: AudioPlayer;

  private voiceConnection?: VoiceConnection;

  private collections: Map<string, WatchTrackCollection<BoomBoxTrack>> = new Map();

  private boombox: BoomBox;

  constructor(options: MedleyMixOptions) {
    super();

    this.queue = new Queue();
    this.medley = new Medley(this.queue);

    if (this.medley.getAudioDevice().type !== 'Null') {
      this.medley.setAudioDevice({ type: 'Null', device: 'Null Device'});
    }

    // Create boombox
    this.boombox = new BoomBox({
      medley: this.medley,
      queue: this.queue,
      crates: []
    });

    // Request audio stream
    this.audioRequest = this.medley.requestAudioStream({
      bufferSize: 480 * 50,
      buffering: 480 * 4, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
      sampleRate: 48000, // discord voice only accept 48KHz sample rate
      format: 'Int16LE', // It's discord voice again, 16 bit per sample
      // TODO: Volume
    });

    // Create discord voice AudioResource
    this.audioResource = createAudioResource(this.audioRequest.stream, { inputType: StreamType.Raw });
    const { encoder } = this.audioResource;
    if (encoder) {
      encoder.setBitrate(128_000);
      encoder.setFEC(true);
      encoder.setPLP(0);
    }

    // Create discord voice AudioPlayer
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 1000
      }
    });

    this.audioPlayer.play(this.audioResource);

    this.boombox.on('trackQueued', this.handleTrackQueued);
    this.boombox.on('trackLoaded', this.handleTrackLoaded);
    this.boombox.on('trackStarted', this.handleTrackStarted);
  }

  private handleTrackQueued = (track: BoomBoxTrack) => {
    this.emit('trackQueued', track);
  }

  private handleTrackLoaded = (track: BoomBoxTrack) => {
    this.emit('trackLoaded', track);
  }

  private handleTrackStarted = (track: BoomBoxTrack, lastTrack?: BoomBoxTrack) => {
    this.emit('trackStarted', track, lastTrack);
    // TODO: Send to channel
  }

  async join(channel: BaseGuildVoiceChannel) {
    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    this.voiceConnection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator as DiscordGatewayAdapterCreator
    });

    try {
      await entersState(this.voiceConnection, VoiceConnectionStatus.Ready, 30e3);
      this.voiceConnection.subscribe(this.audioPlayer);

      // TODO: Check audiences first
      // This will start playback if it was stopped or paused
      if (!this.medley.playing && this.queue.length === 0) {
      }

      this.medley.play();
    }
    catch (e) {
      this.voiceConnection?.destroy();
      this.voiceConnection = undefined;

      throw e;
    }
  }

  // TODO: Manipulating collections directly might be a good option
  updateCollections(newCollections: Record<string, string>) {
    const existingIds = [...this.collections.keys()];
    const newIds = _.keys(newCollections);

    const tobeRemovedIds = _.difference(existingIds, newIds);
    const tobeAdded = _.difference(newIds, existingIds);
    const remainingIds = _.intersection(existingIds, newIds);

    const invalidatedIds = remainingIds.filter((id) => {
      const watched = _.sortedUniq(this.collections.get(id)?.watched || []);
      const tobeWatched = _.castArray(newCollections[id]);

      return !_.isEqual(tobeWatched, watched);
    });

    for (const id of tobeRemovedIds) {
      this.collections.delete(id);
    }

    const todo =_.uniq(tobeAdded.concat(invalidatedIds));
    for (const id of todo) {
      const collection = WatchTrackCollection.initWithWatch<BoomBoxTrack>(id, newCollections[id], {
        newTracksMapper: flow(shuffle, mapTracksMetadata)
      });
      this.collections.set(id, collection);
    }

    this.boombox.crates = _.reject(this.boombox.crates, crate => tobeRemovedIds.includes(crate.source.id));
  }

  updateSequence(sequences: [string, number][]) {
    this.boombox.crates = sequences
      .filter(([collectionId]) => this.collections.has(collectionId))
      .map(([collectionId, max], index) => new Crate(`${index}:${collectionId}-${max}`, this.collections.get(collectionId)!, max));
  }

  private sweepers: Map<string, WatchTrackCollection<BoomBoxTrack>> = new Map();

  updateSweeperRules(...configs: SweeperConfig[]) {
    // TODO: Detect config removal and remove them from sweepersCollections

    this.boombox.sweeperInsertionRules = configs.map<SweeperInsertionRule>(({ from, to, path }) => {
      if (!this.sweepers.has(path)) {
        this.sweepers.set(path, WatchTrackCollection.initWithWatch<BoomBoxTrack>(path, path));
      }

      return {
        from,
        to,
        collection: this.sweepers.get(path)!
      }
    });
  }
}