import { Station, StationTrackPlay } from "@seamless-medley/core";
import { AttachmentBuilder, ButtonBuilder, EmbedBuilder, GuildEmoji, Message } from "discord.js";

export enum TrackMessageStatus {
  Playing,
  Paused,
  Ending,
  Played,
  Skipped
}

export type TrackMessage = {
  station: Station;
  trackPlay: StationTrackPlay;
  status: TrackMessageStatus;
  playDuration: number;
  embed: EmbedBuilder;
  coverImage?: AttachmentBuilder;
  buttons: {
    skip?: ButtonBuilder,
    lyric?: ButtonBuilder,
    more?: ButtonBuilder
  };
  maybeMessage?: Promise<Message<boolean> | undefined>;
  lyricMessage?: Message;

  reactions?: Set<GuildEmoji['id']>;
}
