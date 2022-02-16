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

import { BoomBox,
  BoomBoxEvents,
  BoomBoxTrack,
  BoomBoxTrackPlay,
  Crate,
  decibelsToGain,
  mapTracksMetadataConcurrently,
  mapTracksMetadataSequentially,
  Medley,
  Queue,
  RequestAudioStreamResult,
  RequestTrack,
  SweeperInsertionRule,
  TrackCollection,
  TrackKind,
  TrackPeek,
  WatchTrackCollection
} from "@seamless-medley/core";

import { BaseGuildVoiceChannel, Guild, User } from "discord.js";
import EventEmitter from "events";
import type TypedEventEmitter from 'typed-emitter';
import _, { flow, shuffle, castArray, difference, intersection } from "lodash";
import MiniSearch, { Query, SearchResult } from 'minisearch';

export enum PlayState {
  Idle = 'idle',
  Playing = 'playing',
  Paused = 'paused'
}

export type MedleyMixOptions = {
  /**
   * Initial audio gain, default to -15dBFS (Appx 0.178)
   * @default -15dBFS
   */
  initialGain?: number;

  intros?: TrackCollection<BoomBoxTrack>;

  requestSweepers?: TrackCollection<BoomBoxTrack>;
}

export type SweeperConfig = {
  from?: string[];
  to?: string[];
  path: string;
}

export interface MedleyMixEvents extends Pick<BoomBoxEvents, 'trackQueued' | 'trackLoaded' | 'trackStarted' | 'trackActive' | 'trackFinished'> {
  requestTrackAdded: (track: TrackPeek<RequestTrack<User['id']>>) => void;
}

type MixState = {
  audioRequest: RequestAudioStreamResult;
  audioResource: AudioResource;
  audioPlayer: AudioPlayer;
  voiceConnection?: VoiceConnection;
  gain: number;
}

// This is the DJ
export class MedleyMix extends (EventEmitter as new () => TypedEventEmitter<MedleyMixEvents>) {
  readonly queue: Queue<BoomBoxTrack>;
  readonly medley: Medley<BoomBoxTrack>;
  private states: Map<Guild['id'], MixState> = new Map();

  private collections: Map<string, WatchTrackCollection<BoomBoxTrack>> = new Map();
  private boombox: BoomBox<User['id']>;

  private initialGain: number;
  private intros?: TrackCollection<BoomBoxTrack>;
  private requestSweepers?: TrackCollection<BoomBoxTrack>;

  private miniSearch = new MiniSearch<BoomBoxTrack>({
    fields: ['artist', 'title'],
    extractField: (track, field) => {
      if (field === 'id') {
        return track.id;
      }

      return _.get(track.metadata?.tags, field);
    }
  });

  constructor(options: MedleyMixOptions = {}) {
    super();

    this.queue = new Queue();
    this.medley = new Medley(this.queue);

    if (this.medley.getAudioDevice().type !== 'Null') {
      this.medley.setAudioDevice({ type: 'Null', device: 'Null Device'});
    }

    // Create boombox
    const boombox = new BoomBox({
      medley: this.medley,
      queue: this.queue,
      crates: []
    });

    boombox.on('trackQueued', this.handleTrackQueued);
    boombox.on('trackLoaded', this.handleTrackLoaded);
    boombox.on('trackStarted', this.handleTrackStarted);
    boombox.on('trackActive', this.handleTrackActive);
    boombox.on('trackFinished', this.handleTrackFinished);
    boombox.on('requestTrackFetched', this.handleRequestTrack);

    this.boombox = boombox;
    this.initialGain = options.initialGain || decibelsToGain(-15);
    this.intros = options.intros;
    this.requestSweepers = options.requestSweepers;
  }

  private handleTrackQueued = (track: BoomBoxTrack) => {
    this.emit('trackQueued', track);
  }

  private handleTrackLoaded = (trackPlay: BoomBoxTrackPlay) => {
    this.emit('trackLoaded', trackPlay);
  }

  private handleTrackStarted = (trackPlay: BoomBoxTrackPlay, lastTrack?: BoomBoxTrackPlay) => {
    this.emit('trackStarted', trackPlay, lastTrack);
  }

  private handleTrackActive = (trackPlay: BoomBoxTrackPlay) => {
    this.emit('trackActive', trackPlay);
  }

  private handleTrackFinished = (trackPlay: BoomBoxTrackPlay) => {
    this.emit('trackFinished', trackPlay);
  }

  private handleRequestTrack = (track: RequestTrack<void>) => {
    const { requestSweepers } = this;

    if (requestSweepers) {

      const currentKind = this.boombox.trackPlay?.track.metadata?.kind;

      if (currentKind !== TrackKind.Request) {
        const sweeper = requestSweepers.shift();

        if (sweeper && this.medley.isTrackLoadable(sweeper)) {
          this.queue.add(sweeper.path);
          requestSweepers.push(sweeper);
        }
      }
    }
  }

  async prepareFor(guildId: Guild['id']) {
    if (this.states.has(guildId)) {
      return;
    }

    const gain = this.initialGain;

    // Request audio stream
    const audioRequest = await this.medley.requestAudioStream({
      bufferSize: 48000 * 0.5,
      buffering: 480 * 4, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making 40ms latency in total
      preFill: 48000 * 0.5, // Pre-fill the stream with at least 500ms of audio, to reduce stuttering while encoding to Opus
      // discord voice only accept 48KHz sample rate, 16 bit per sample
      sampleRate: 48000,
      format: 'Int16LE',
      gain,
    });

    // Create discord voice AudioResource
    const audioResource = createAudioResource(audioRequest.stream, { inputType: StreamType.Raw });
    const { encoder } = audioResource;
    if (encoder) {
      encoder.setBitrate(128_000);
      encoder.setFEC(true);
      encoder.setPLP(0);
    }

    // Create discord voice AudioPlayer
    const audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 1000
      }
    });

    audioPlayer.play(audioResource);

    this.states.set(guildId, {
      audioRequest,
      audioResource,
      audioPlayer,
      gain
    });
  }

  getGain(guildId: Guild['id']) {
    const state = this.states.get(guildId);
    return state ? state.gain : 0;
  }

  setGain(guildId: Guild['id'], val: number): boolean {
    const state = this.states.get(guildId);
    if (!state) {
      return false;
    }

    state.gain = val;

    this.medley.updateAudioStream(state.audioRequest.id, { gain: val });
    return true;
  }

  get playing() {
    return this.medley.playing;
  }

  get paused() {
    return this.medley.paused;
  }

  get playState(): PlayState {
    if (this.paused) return PlayState.Paused;
    if (this.playing) return PlayState.Playing;
    return PlayState.Idle;
  }

  get trackPlay() {
    return this.boombox.trackPlay;
  }

  skip() {
    this.medley.fadeOut();
  }

  async join(channel: BaseGuildVoiceChannel) {
    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    await this.prepareFor(guildId);
    const state = this.states.get(guildId)!;

    let voiceConnection: VoiceConnection | undefined = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator as DiscordGatewayAdapterCreator
    });

    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 30e3);
      voiceConnection.subscribe(state.audioPlayer);
    }
    catch (e) {
      voiceConnection?.destroy();
      voiceConnection = undefined;

      throw e;
    }

    if (voiceConnection) {
      state.voiceConnection = voiceConnection;
    }
  }

  start() {
    if (this.playState === PlayState.Idle && this.queue.length === 0) {
      if (this.intros) {
        const intro = this.intros.shift();
        if (intro) {
          this.queue.add(intro);
          this.intros.push(intro);
        }
      }
    }

    if (!this.medley.playing) {
      console.log('Start playing');
    }

    this.medley.play();
  }

  pause() {
    if (!this.medley.paused) {
      this.medley.togglePause();
    }
  }

  private indexNewTracks = async (awaitable: Promise<BoomBoxTrack[]>) => {
    const tracks = await awaitable;
    this.miniSearch.addAllAsync(tracks);
    return tracks;
  }

  private tracksMapper = flow(shuffle, mapTracksMetadataConcurrently, this.indexNewTracks);

  // TODO: Manipulating collections directly might be a good option
  updateCollections(newCollections: Record<string, string>) {
    const existingIds = [...this.collections.keys()];
    const newIds = _.keys(newCollections);

    const tobeRemovedIds = difference(existingIds, newIds);
    const tobeAdded = difference(newIds, existingIds);
    const remainingIds = intersection(existingIds, newIds);

    const invalidatedIds = remainingIds.filter((id) => {
      const watched = _(this.collections.get(id)?.watched || []).sort().uniq().value();
      const tobeWatched = castArray(newCollections[id]);

      return !_.isEqual(tobeWatched, watched);
    });

    for (const id of tobeRemovedIds) {
      this.collections.delete(id);
    }


    const todo =_.uniq(tobeAdded.concat(invalidatedIds));
    for (const id of todo) {
      const collection = WatchTrackCollection.initWithWatch<BoomBoxTrack>(
        id,
        newCollections[id],
        { tracksMapper: this.tracksMapper }
      );

      collection.once('ready', () => collection.shuffle());

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
    const oldPaths = this.boombox.sweeperInsertionRules.map(r => r.collection.id);

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

    const newPaths = this.boombox.sweeperInsertionRules.map(r => r.collection.id);
    const removedPaths = difference(oldPaths, newPaths);

    for (const path of removedPaths) {
      this.sweepers.delete(path);
    }
  }

  findTrackById(id: BoomBoxTrack['id']) {
    for (const collection of this.collections.values()) {
      const track = collection.fromId(id);
      if (track) {
        return track;
      }
    }
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

  async request(trackId: BoomBoxTrack['id'], requestedBy: User['id']) {
    const track = this.findTrackById(trackId);
    if (!track) {
      return false;
    }

    if (!this.medley.isTrackLoadable(track)) {
      return false;
    }

    const requestedTrack = this.boombox.request(track, requestedBy);

    this.emit('requestTrackAdded', requestedTrack);

    return requestedTrack;
  }

  get requestsCount() {
    return this.boombox.requestsCount;
  }

  peekRequests(from: number, n: number) {
    return this.boombox.peekRequests(from, n);
  }

  get requestsEnabled() {
    return this.boombox.requestsEnabled;
  }

  set requestsEnabled(value: boolean) {
    this.boombox.requestsEnabled = value;
  }

  sortRequests() {
    this.boombox.sortRequests();
  }

  setCrateIndex(newIndex: number) {
    this.boombox.setCrateIndex(newIndex);
  }
}