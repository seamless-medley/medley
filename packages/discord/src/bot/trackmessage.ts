import { BoomBoxTrackPlay, isRequestTrack, Metadata, MusicLibraryMetadata } from "@seamless-medley/core";
import { Message, MessageActionRow, MessageAttachment, MessageButton, MessageEmbed, MessageOptions } from "discord.js";
import { capitalize, isEmpty, get } from "lodash";
import mime from 'mime-types';
import { parse as parsePath } from 'path';
import { Station } from "./station";

export enum TrackMessageStatus {
  Playing,
  Paused,
  Played,
  Skipped
}

export type TrackMessage = {
  trackPlay: BoomBoxTrackPlay;
  status: TrackMessageStatus;
  embed: MessageEmbed;
  coverImage?: MessageAttachment;
  buttons: {
    skip?: MessageButton,
    lyric?: MessageButton
  };
  sentMessage?: Message;
  lyricMessage?: Message;
}

export async function createTrackMessage(trackPlay: BoomBoxTrackPlay): Promise<TrackMessage> {
  const { track } = trackPlay;
  const requestedBy = isRequestTrack<string>(track) ? track.requestedBy : undefined;

  const embed = new MessageEmbed()
    .setColor('RANDOM')
    .setTitle(requestedBy ? 'Playing your request' : 'Playing');

  const { metadata } = track;

  let coverImage: MessageAttachment | undefined;

  if (metadata) {
    const { tags, maybeCoverAndLyrics } = metadata;
    if (tags) {
      const { title } = tags;

      if (title) {
        embed.setDescription(title);
      }

      for (const tag of ['artist', 'album', 'genre']) {
        const val = get<Metadata, keyof Metadata, ''>(tags,
          tag as keyof Metadata,
          ''
        ).toString();

        if (!isEmpty(val)) {
          embed.addField(capitalize(tag), val, true);
        }
      }
    }

    const coverAndLyrics = await maybeCoverAndLyrics;

    if (coverAndLyrics) {
      const { cover, coverMimeType } = coverAndLyrics;

      if (cover.length) {
        embed.setColor('RANDOM');

        const ext = mime.extension(coverMimeType);
        coverImage = new MessageAttachment(cover, `cover.${ext}`);
      }

    }
  } else {
    embed.setDescription(parsePath(track.path).name);
  }

  if (track.collection.metadata) {
    const { description, owner: station } = track.collection.metadata as MusicLibraryMetadata<Station>;

    embed.addField('Collection', description ?? track.collection.id);
    embed.addField('Station', station.name);
  }

  if (requestedBy?.length) {
    const mentions = requestedBy.map(id =>  `<@${id}>`).join(' ');
    embed.addField('Requested by', mentions);
  }

  if (coverImage) {
    embed.setThumbnail(`attachment://${coverImage.name}`)
  }

  const lyricButton = new MessageButton()
    .setLabel('Lyrics')
    .setEmoji('📜')
    .setStyle('SECONDARY')
    .setCustomId(`lyrics:${track.id}`);

  const skipButton = new MessageButton()
    .setLabel('Skip')
    .setEmoji('⛔')
    .setStyle('DANGER')
    .setCustomId(`skip:${trackPlay.uuid}`);

  return {
    trackPlay,
    status: TrackMessageStatus.Playing,
    embed,
    coverImage,
    buttons: {
      lyric: lyricButton,
      skip: skipButton
    }
  };
}

export function trackMessageToMessageOptions(msg: TrackMessage): MessageOptions {
  const { lyric, skip } = msg.buttons;

  let actionRow: MessageActionRow | undefined = undefined;

  if (lyric || skip) {
    actionRow = new MessageActionRow();

    if (lyric) {
      actionRow.addComponents(lyric);
    }

    if (skip) {
      actionRow.addComponents(skip);
    }
  }

  return {
    embeds: [msg.embed],
    files: msg.coverImage ? [msg.coverImage] : undefined,
    components: actionRow ? [actionRow] : []
  }
}
