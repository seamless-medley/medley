import { BoomBoxTrack, Medley, Queue, RequestAudioStreamResult } from "@medley/core";

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

import { VoiceChannel } from "discord.js";

export type MedleyMixOptions = {
  collections: Record<string, string>;
  sequences: [string, number][];
}

// This is the DJ
export class MedleyMix {
  private queue: Queue;
  private medley: Medley;

  private audioRequest: RequestAudioStreamResult;
  private audioResource: AudioResource;
  private audioPlayer: AudioPlayer;

  private voiceConnection?: VoiceConnection;

  constructor() {
    this.queue = new Queue<BoomBoxTrack>();
    this.medley = new Medley(this.queue);

    if (this.medley.getAudioDevice().type !== 'Null') {
      this.medley.setAudioDevice({ type: 'Null', device: 'Null Device'});
    }

    console.log(this.medley.getAudioDevice());

    // TODO: Load collections
    // TODO: Load sequences
    // TODO: Create crates
    // TODO: Create boombox
    // TODO: Load sweepers and rules

    // TODO: handle trackStarted event
    // TODO: Set volume

    // Request audio stream
    this.audioRequest = this.medley.requestAudioStream({
      bufferSize: 480 * 50,
      buffering: 480 * 4, // discord voice consumes stream every 20ms, so we buffer more 20ms ahead of time, making total 40ms latency
      sampleRate: 48000, // discord voice only accept 48KHz sample rate
      format: 'Int16LE', // It's discord voice again, 16 bit per sample
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
  }

  async join(channel: VoiceChannel) {
    const { id: channelId, guildId, guild: { voiceAdapterCreator } } = channel;

    this.voiceConnection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: voiceAdapterCreator as DiscordGatewayAdapterCreator
    });

    try {
      await entersState(this.voiceConnection, VoiceConnectionStatus.Ready, 30e3);
      this.voiceConnection.subscribe(this.audioPlayer);

      // This will start playback if it was stopped or paused
      this.medley.play();
    }
    catch (e) {
      this.voiceConnection?.destroy();
      this.voiceConnection = undefined;

      console.error(e);
    }
  }
}