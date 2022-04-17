import { RequestAudience, BoomBoxTrack, BoomBoxTrackPlay, isRequestTrack, Metadata, MusicLibraryMetadata, Station, extractAudienceGroup, AudienceType } from "@seamless-medley/core";
import { Message, MessageActionRow, MessageAttachment, MessageButton, MessageEmbed, MessageOptions } from "discord.js";
import { capitalize, isEmpty, get } from "lodash";
import mime from 'mime-types';
import { parse as parsePath } from 'path';

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

export async function createTrackMessage(guildId: string, trackPlay: BoomBoxTrackPlay, actualTrack?: BoomBoxTrack): Promise<TrackMessage> {
  const requested = isRequestTrack<RequestAudience>(trackPlay.track) ? trackPlay.track : undefined;
  const requestedBy = requested?.requestedBy;
  const track  = actualTrack ?? requested?.original ?? trackPlay.track;

  const embed = new MessageEmbed()
    .setColor('RANDOM')
    .setTitle(requestedBy?.length ? 'Playing your request' : 'Playing');

  const { metadata } = track;

  let coverImage: MessageAttachment | undefined;

  if (metadata) {
    const { tags, maybeCoverAndLyrics } = metadata;
    if (tags) {
      const { title } = tags;

      if (title) {
        embed.setDescription(`> ${title}`);
      }

      for (const tag of ['artist', 'album', 'genre']) {
        const val = get<Metadata, keyof Metadata, ''>(tags,
          tag as keyof Metadata,
          ''
        ).toString();

        if (!isEmpty(val)) {
          embed.addField(capitalize(tag), `> ${val}`, true);
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

  const requesters = (requestedBy || [])
    .map(r => ({
      ...extractAudienceGroup(r.group),
      id: r.id
    }))
    .filter(({ type, groupId }) => type === AudienceType.Discord && groupId === guildId)
    .map(r => r.id);

  if (coverImage) {
    embed.setThumbnail(`attachment://${coverImage.name}`)
  }

  if (requestedBy?.length) {
    const mentions =  requesters.length > 0 ? requesters.map(id =>  `<@${id}>`).join(' ') : '> `Someone else`';
    embed.addField('Requested by', mentions);
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
  const { embed, coverImage, buttons } = msg;

  const { lyric, skip } = buttons;

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
    embeds: [embed],
    files: coverImage ? [coverImage] : undefined,
    components: actionRow ? [actionRow] : []
  }
}
