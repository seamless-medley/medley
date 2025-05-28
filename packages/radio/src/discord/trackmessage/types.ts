import { AttachmentBuilder, ButtonBuilder, EmbedBuilder, GuildEmoji, Message } from "discord.js";
import { Station, StationTrackPlay } from "../../core";

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
  guildId: string;
  maybeMessage?: Promise<Message<boolean> | undefined>;
  lyricMessage?: Message;

  reactions?: Set<GuildEmoji['id']>;
}
